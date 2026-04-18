local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")

local HttpClient = require(script.Parent.network.HttpClient)
local WebSocketClient = require(script.Parent.network.WebSocketClient)
local Deserializer = require(script.Parent.sync.Deserializer)
local Listener = require(script.Parent.sync.Listener)
local Serializer = require(script.Parent.sync.Serializer)
local PathUtil = require(script.Parent.util.PathUtil)

local DEFAULT_SERVER_URL = "http://127.0.0.1:34872"
local SERVICE_NAMES = {
	"Workspace",
	"Players",
	"ReplicatedFirst",
	"ReplicatedStorage",
	"ServerScriptService",
	"ServerStorage",
	"StarterGui",
	"StarterPack",
	"StarterPlayer",
	"Teams",
	"Lighting",
	"SoundService",
}

local toolbar = plugin:CreateToolbar("RoSync")
local button = toolbar:CreateButton("RoSync", "Open the RoSync panel", "")

local widgetInfo = DockWidgetPluginGuiInfo.new(
	Enum.InitialDockState.Right,
	false,
	false,
	520,
	680,
	360,
	500
)

local widget = plugin:CreateDockWidgetPluginGui("RoSyncDock", widgetInfo)
widget.Title = "RoSync"

local root = Instance.new("Frame")
root.Size = UDim2.fromScale(1, 1)
root.BackgroundColor3 = Color3.fromRGB(20, 24, 31)
root.BorderSizePixel = 0
root.Parent = widget

local listLayout = Instance.new("UIListLayout")
listLayout.Padding = UDim.new(0, 8)
listLayout.Parent = root

local padding = Instance.new("UIPadding")
padding.PaddingTop = UDim.new(0, 12)
padding.PaddingBottom = UDim.new(0, 12)
padding.PaddingLeft = UDim.new(0, 12)
padding.PaddingRight = UDim.new(0, 12)
padding.Parent = root

local function createLabel(height, text, font, size, color)
	local label = Instance.new("TextLabel")
	label.Size = UDim2.new(1, 0, 0, height)
	label.BackgroundTransparency = 1
	label.Font = font
	label.Text = text
	label.TextWrapped = true
	label.TextColor3 = color
	label.TextSize = size
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.TextYAlignment = Enum.TextYAlignment.Top
	label.Parent = root
	return label
end

local function createField(labelText, defaultValue)
	local container = Instance.new("Frame")
	container.Size = UDim2.new(1, 0, 0, 58)
	container.BackgroundTransparency = 1
	container.Parent = root

	local label = Instance.new("TextLabel")
	label.Size = UDim2.new(1, 0, 0, 18)
	label.BackgroundTransparency = 1
	label.Text = labelText
	label.TextColor3 = Color3.fromRGB(235, 239, 244)
	label.Font = Enum.Font.GothamMedium
	label.TextSize = 13
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.Parent = container

	local input = Instance.new("TextBox")
	input.Size = UDim2.new(1, 0, 0, 34)
	input.Position = UDim2.new(0, 0, 0, 24)
	input.BackgroundColor3 = Color3.fromRGB(30, 36, 45)
	input.BorderSizePixel = 0
	input.ClearTextOnFocus = false
	input.Text = defaultValue
	input.TextColor3 = Color3.fromRGB(235, 239, 244)
	input.Font = Enum.Font.Code
	input.TextSize = 13
	input.TextXAlignment = Enum.TextXAlignment.Left
	input.Parent = container

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 6)
	corner.Parent = input

	local inputPadding = Instance.new("UIPadding")
	inputPadding.PaddingLeft = UDim.new(0, 10)
	inputPadding.PaddingRight = UDim.new(0, 10)
	inputPadding.Parent = input

	return input
end

local function createButtonRow(labels)
	local row = Instance.new("Frame")
	row.Size = UDim2.new(1, 0, 0, 74)
	row.BackgroundTransparency = 1
	row.Parent = root

	local layout = Instance.new("UIGridLayout")
	layout.CellPadding = UDim2.new(0, 8, 0, 8)
	layout.CellSize = UDim2.new(0.25, -6, 0, 32)
	layout.Parent = row

	local buttons = {}
	for _, labelText in ipairs(labels) do
		local actionButton = Instance.new("TextButton")
		actionButton.Text = labelText
		actionButton.TextColor3 = Color3.fromRGB(255, 255, 255)
		actionButton.TextSize = 13
		actionButton.Font = Enum.Font.GothamMedium
		actionButton.BackgroundColor3 = Color3.fromRGB(53, 91, 196)
		actionButton.BorderSizePixel = 0
		actionButton.Parent = row

		local corner = Instance.new("UICorner")
		corner.CornerRadius = UDim.new(0, 6)
		corner.Parent = actionButton

		buttons[labelText] = actionButton
	end

	return buttons
end

createLabel(24, "RoSync", Enum.Font.GothamBold, 18, Color3.fromRGB(245, 247, 250))
createLabel(38, "RoSync uses Studio Output for live connection logs while keeping sync controls in this panel.", Enum.Font.Gotham, 13, Color3.fromRGB(180, 188, 198))

local serverUrlBox = createField("Server URL", DEFAULT_SERVER_URL)
local statusLabel = createLabel(20, "Disconnected", Enum.Font.GothamMedium, 13, Color3.fromRGB(227, 95, 95))
local selectionLabel = createLabel(36, "Selection: none", Enum.Font.Code, 12, Color3.fromRGB(180, 188, 198))
local buttons = createButtonRow({ "Connect", "Start Watch", "Push All", "Pull All", "Push Selection", "Status", "Refresh", "Disconnect" })

local logBox = Instance.new("TextBox")
logBox.Size = UDim2.new(1, 0, 0, 340)
logBox.BackgroundColor3 = Color3.fromRGB(12, 15, 20)
logBox.BorderSizePixel = 0
logBox.ClearTextOnFocus = false
logBox.MultiLine = true
logBox.Font = Enum.Font.Code
logBox.TextXAlignment = Enum.TextXAlignment.Left
logBox.TextYAlignment = Enum.TextYAlignment.Top
logBox.TextWrapped = false
logBox.TextSize = 13
logBox.TextColor3 = Color3.fromRGB(234, 238, 242)
logBox.Text = ""
logBox.Parent = root

local logCorner = Instance.new("UICorner")
logCorner.CornerRadius = UDim.new(0, 6)
logCorner.Parent = logBox

local logPadding = Instance.new("UIPadding")
logPadding.PaddingTop = UDim.new(0, 8)
logPadding.PaddingBottom = UDim.new(0, 8)
logPadding.PaddingLeft = UDim.new(0, 10)
logPadding.PaddingRight = UDim.new(0, 10)
logPadding.Parent = logBox

local clientId = HttpService:GenerateGUID(false)
local httpClient = HttpClient.new(DEFAULT_SERVER_URL)
local socketClient = nil
local stopWatching = nil
local applyInProgress = false
local refreshInFlight = false
local refreshQueued = false
local desiredConnection = false
local reconnectAttempt = 0
local reconnectThread = nil
local pollingThread = nil
local connectSocket
local pushServices

local function writeOutput(message, level)
	local formatted = "[RoSync Plugin] " .. tostring(message)
	if level == "warn" or level == "error" then
		warn(formatted)
	else
		print(formatted)
	end
end

local function appendLog(message, level)
	local entry = string.format("[%s] %s", os.date("%H:%M:%S"), tostring(message))
	if logBox.Text == "" then
		logBox.Text = entry
	else
		logBox.Text ..= "\n\n" .. entry
	end

	writeOutput(entry, level)
end

local function setStatus(text, color)
	statusLabel.Text = text
	statusLabel.TextColor3 = color
end

local function currentServerUrl()
	return string.gsub(serverUrlBox.Text, "/+$", "")
end

local function appendConnectionHint()
	appendLog("Tip: run `rosync watch` first, then use http://127.0.0.1:34872 or the exact host/port printed by the daemon.")
end

local function stopPolling()
	if pollingThread then
		task.cancel(pollingThread)
		pollingThread = nil
	end
end

local function cancelReconnect()
	if reconnectThread then
		task.cancel(reconnectThread)
		reconnectThread = nil
	end
end

local function refreshSelection()
	local selected = Selection:Get()
	if #selected == 0 then
		selectionLabel.Text = "Selection: none"
		return nil
	end

	local instance = selected[1]
	selectionLabel.Text = string.format("Selection: %s\nPath: %s", instance.Name, PathUtil.getInstancePath(instance))
	return instance
end

local function sendMessage(payload)
	if not socketClient or not socketClient:isConnected() then
		appendLog("WebSocket is not connected.")
		return false
	end

	local success, result = socketClient:send(payload)
	if not success then
		appendLog("Send failed: " .. tostring(result))
	end
	return success
end

local function fetchAndApplyTree(reason)
	if refreshInFlight then
		refreshQueued = true
		return
	end

	refreshInFlight = true
	httpClient:setBaseUrl(currentServerUrl())

	local success, response = httpClient:getTree()
	if not success then
		appendLog("Tree fetch failed (" .. tostring(reason) .. "): " .. tostring(response), "warn")
		refreshInFlight = false
		return
	end

	applyInProgress = true
	local applied, applyError = Deserializer.applyTree(response.tree)
	applyInProgress = false

	if applied and reason ~= "poll" then
		appendLog("Applied daemon tree (" .. tostring(reason) .. ").")
	elseif not applied then
		appendLog("Tree apply failed (" .. tostring(reason) .. "): " .. tostring(applyError), "warn")
	end

	refreshInFlight = false

	if refreshQueued then
		refreshQueued = false
		task.defer(function()
			fetchAndApplyTree("queued")
		end)
	end
end

local function startPolling(reason)
	if pollingThread then
		return
	end

	appendLog("HTTP polling active (" .. tostring(reason) .. ").")
	pollingThread = task.spawn(function()
		while desiredConnection and (not socketClient or not socketClient:isConnected()) do
			fetchAndApplyTree("poll")
			task.wait(2)
		end
		pollingThread = nil
	end)
end

local function scheduleReconnect()
	if not desiredConnection or reconnectThread then
		return
	end

	local delaySeconds = math.min(30, 2 ^ reconnectAttempt)
	reconnectAttempt += 1
	appendLog("Scheduling reconnect in " .. tostring(delaySeconds) .. "s.")
	reconnectThread = task.delay(delaySeconds, function()
		reconnectThread = nil
		if desiredConnection then
			connectSocket(true)
		end
	end)
end

local function handleSocketMessage(message)
	local success, payload = pcall(function()
		return HttpService:JSONDecode(message)
	end)

	if not success or type(payload) ~= "table" then
		return
	end

	if payload.type == "WELCOME" then
		reconnectAttempt = 0
		stopPolling()
		appendLog("Daemon handshake complete. Studio is now connected over WebSocket.")
		fetchAndApplyTree("welcome")
		return
	end

	if payload.type == "PROJECT_TREE" and type(payload.tree) == "table" then
		applyInProgress = true
		local applied, applyError = Deserializer.applyTree(payload.tree)
		applyInProgress = false

		if applied then
			appendLog("Applied daemon project tree.")
		else
			appendLog("Project tree apply failed: " .. tostring(applyError), "warn")
		end
		return
	end

	if payload.type == "PUSH_REQUEST" then
		fetchAndApplyTree("push-request")
		return
	end

	if payload.type == "PULL_REQUEST" then
		pushServices()
		return
	end

	if payload.type == "SYNC_INSTANCE" and type(payload.path) == "string" and type(payload.data) == "table" then
		applyInProgress = true
		local applied, applyError = Deserializer.applySyncInstance(payload.path, payload.data)
		applyInProgress = false

		if applied then
			appendLog("Applied sync for " .. payload.path)
		else
			appendLog("Sync apply failed for " .. payload.path .. ": " .. tostring(applyError), "warn")
		end
		return
	end

	if payload.type == "REMOVE_INSTANCE" and type(payload.path) == "string" then
		applyInProgress = true
		local removed, removeError = Deserializer.removeAtPath(payload.path)
		applyInProgress = false

		if removed then
			appendLog("Removed " .. payload.path)
		else
			appendLog("Remove failed for " .. payload.path .. ": " .. tostring(removeError), "warn")
		end
		return
	end

	if payload.type == "RENAME_INSTANCE" and type(payload.oldPath) == "string" and type(payload.newPath) == "string" then
		applyInProgress = true
		local renamed, renameError = Deserializer.renameAtPath(payload.oldPath, payload.newPath)
		applyInProgress = false

		if renamed then
			appendLog("Renamed " .. payload.oldPath .. " -> " .. payload.newPath)
		else
			appendLog("Rename failed for " .. payload.oldPath .. ": " .. tostring(renameError), "warn")
		end
		return
	end

	if payload.type == "FILE_SYSTEM_CHANGED"
		or payload.type == "INSTANCE_ADDED"
		or payload.type == "INSTANCE_CHANGED"
		or payload.type == "INSTANCE_REMOVED"
		or payload.type == "INSTANCE_RENAMED" then
		fetchAndApplyTree(payload.type)
		return
	end

	if payload.type == "CONFLICT" then
		setStatus("Conflict", Color3.fromRGB(242, 186, 82))
		appendLog("Conflict: " .. tostring(payload.reason or payload.path), "warn")
		return
	end

	if payload.type == "ERROR" then
		appendLog("Daemon error: " .. tostring(payload.message), "warn")
	end
end

connectSocket = function(isReconnect)
	httpClient:setBaseUrl(currentServerUrl())
	cancelReconnect()

	socketClient = WebSocketClient.new(currentServerUrl(), {
		onOpen = function()
			appendLog("WebSocket opened.")
		end,
		onMessage = handleSocketMessage,
		onError = function(responseStatusCode, errorMessage)
			appendLog(
				"WebSocket error"
					.. (responseStatusCode and responseStatusCode > 0 and (" (" .. tostring(responseStatusCode) .. ")") or "")
					.. ": "
					.. tostring(errorMessage),
				"warn"
			)
		end,
		onClose = function(wasConnected)
			if socketClient then
				socketClient:close()
				socketClient = nil
			end
			if desiredConnection then
				setStatus("Polling", Color3.fromRGB(242, 186, 82))
				appendLog(
					wasConnected and "WebSocket closed. Falling back to HTTP polling."
						or "WebSocket closed before the daemon handshake completed. Falling back to HTTP polling.",
					"warn"
				)
				startPolling("socket-closed")
				scheduleReconnect()
				return
			end
			stopPolling()
			setStatus("Disconnected", Color3.fromRGB(227, 95, 95))
			appendLog("WebSocket closed.")
		end,
	})

	local connected, errorMessage = socketClient:connect()
	if not connected then
		socketClient = nil
		appendLog("WebSocket connect failed: " .. tostring(errorMessage), "warn")
		appendConnectionHint()
		setStatus("Polling", Color3.fromRGB(242, 186, 82))
		startPolling(isReconnect and "reconnect-fallback" or "initial-fallback")
		scheduleReconnect()
		return false
	end

	stopPolling()
	local helloSent = sendMessage({
		type = "HELLO",
		version = "0.1.0",
		client = "studio",
		clientId = clientId,
	})
	if not helloSent then
		appendLog("Connected transport, but HELLO could not be sent.", "warn")
	end

	setStatus("Connected", Color3.fromRGB(126, 214, 149))
	appendLog("Connected to RoSync daemon at " .. currentServerUrl() .. ".")
	return true
end

local function pushInstance(instance)
	local serialized = Serializer.serializeInstance(instance, true)
	sendMessage({
		type = "SYNC_INSTANCE",
		path = PathUtil.getInstancePath(instance),
		data = serialized,
	})
end

pushServices = function()
	local pushedCount = 0

	for _, serviceName in ipairs(SERVICE_NAMES) do
		local success, service = pcall(function()
			return game:GetService(serviceName)
		end)

		if success and service then
			pushInstance(service)
			pushedCount += 1
		end
	end

	appendLog("Pushed " .. tostring(pushedCount) .. " top-level services to the daemon.")
end

local function startWatch()
	if stopWatching then
		appendLog("Watch is already running.")
		return
	end

	stopWatching = Listener.attach(function(instance)
		return instance ~= nil and instance ~= game and not applyInProgress
	end, {
		onAdded = function(instance)
			pushInstance(instance)
		end,
		onChanged = function(instance)
			pushInstance(instance)
		end,
		onRenamed = function(_, oldPath, newPath)
			sendMessage({
				type = "RENAME_INSTANCE",
				oldPath = oldPath,
				newPath = newPath,
			})
		end,
		onRemoving = function(_, previousPath)
			sendMessage({
				type = "REMOVE_INSTANCE",
				path = previousPath,
			})
		end,
	}, {
		debounceSeconds = 0.15,
	})

	appendLog("Studio watch started.")
end

local function stopWatch()
	if stopWatching then
		stopWatching()
		stopWatching = nil
		appendLog("Studio watch stopped.")
	end
end

buttons.Connect.MouseButton1Click:Connect(function()
	httpClient:setBaseUrl(currentServerUrl())
	desiredConnection = true
	local success, response = httpClient:getHealth()
	if success then
		setStatus("Connecting...", Color3.fromRGB(242, 186, 82))
		appendLog(
			"HTTP health OK for " .. currentServerUrl() .. " (project " .. tostring(response.project or "unknown") .. "). Opening WebSocket..."
		)
		connectSocket(false)
	else
		setStatus("Polling", Color3.fromRGB(242, 186, 82))
		appendLog("HTTP health failed: " .. tostring(response), "warn")
		appendConnectionHint()
		startPolling("health-check")
		scheduleReconnect()
	end
end)

buttons["Start Watch"].MouseButton1Click:Connect(startWatch)

buttons["Push All"].MouseButton1Click:Connect(function()
	pushServices()
end)

buttons["Pull All"].MouseButton1Click:Connect(function()
	sendMessage({
		type = "PULL_REQUEST",
	})
end)

buttons["Push Selection"].MouseButton1Click:Connect(function()
	local selected = refreshSelection()
	if selected then
		pushInstance(selected)
	end
end)

buttons.Status.MouseButton1Click:Connect(function()
	httpClient:setBaseUrl(currentServerUrl())
	local success, response = httpClient:getHealth()
	if success then
		local connections = response.connections or {}
		appendLog(
			"Status: project="
				.. tostring(response.project or "unknown")
				.. ", studio="
				.. tostring(connections.studio or 0)
				.. ", editor="
				.. tostring(connections.editor or 0)
				.. ", host="
				.. tostring(response.host or "?")
				.. ", port="
				.. tostring(response.port or "?")
		)
	else
		appendLog("Status failed: " .. tostring(response), "warn")
	end
end)

buttons.Refresh.MouseButton1Click:Connect(function()
	refreshSelection()
	fetchAndApplyTree("manual-refresh")
end)

buttons.Disconnect.MouseButton1Click:Connect(function()
	desiredConnection = false
	cancelReconnect()
	stopPolling()
	stopWatch()
	if socketClient then
		socketClient:close()
		socketClient = nil
	end
	setStatus("Disconnected", Color3.fromRGB(227, 95, 95))
	appendLog("Disconnected from RoSync.")
end)

Selection.SelectionChanged:Connect(refreshSelection)

button.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)

refreshSelection()
appendLog("RoSync plugin ready. Open View > Output to inspect live plugin logs.")
