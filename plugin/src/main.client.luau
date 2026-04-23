local HttpService = game:GetService("HttpService")

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

local ROOT_COLOR = Color3.fromRGB(18, 18, 28)
local HEADER_COLOR = Color3.fromRGB(24, 24, 38)
local PANEL_COLOR = Color3.fromRGB(28, 28, 42)
local PANEL_BORDER = Color3.fromRGB(45, 55, 72)
local TEXT_PRIMARY = Color3.fromRGB(241, 245, 249)
local STATUS_CONNECTED = Color3.fromRGB(34, 197, 94)
local STATUS_DISCONNECTED = Color3.fromRGB(239, 68, 68)
local STATUS_RECONNECTING = Color3.fromRGB(249, 115, 22)
local STATUS_CONFLICT = Color3.fromRGB(234, 179, 8)
local CONNECT_BLUE = Color3.fromRGB(59, 130, 246)
local DISCONNECT_RED = Color3.fromRGB(239, 68, 68)
local PUSH_ORANGE = Color3.fromRGB(249, 115, 22)
local PULL_PURPLE = Color3.fromRGB(168, 85, 247)
local STATUS_GRAY = Color3.fromRGB(107, 114, 128)

local EVENT_COLOR = {
	add = "rgb(34,197,94)",
	update = "rgb(234,179,8)",
	remove = "rgb(239,68,68)",
	rename = "rgb(255,255,255)",
	move = "rgb(59,130,246)",
	info = "rgb(156,163,175)",
	error = "rgb(248,113,113)",
	source = "rgb(148,163,184)",
	path = "rgb(241,245,249)",
}

local EVENT_PREFIX = {
	add = "+",
	update = "~",
	remove = "-",
	rename = "→",
	move = "⇄",
	info = "·",
	error = "!",
}

local function escapeRichText(value)
	value = string.gsub(tostring(value), "&", "&amp;")
	value = string.gsub(value, "<", "&lt;")
	value = string.gsub(value, ">", "&gt;")
	return value
end

local root = Instance.new("Frame")
root.Size = UDim2.fromScale(1, 1)
root.BackgroundColor3 = ROOT_COLOR
root.BorderSizePixel = 0
root.Parent = widget

local function applyCorner(instance)
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 6)
	corner.Parent = instance
end

local function createButton(parent, text, color, position, size)
	local actionButton = Instance.new("TextButton")
	actionButton.Position = position
	actionButton.Size = size
	actionButton.BackgroundColor3 = color
	actionButton.BorderSizePixel = 0
	actionButton.AutoButtonColor = false
	actionButton.Font = Enum.Font.GothamMedium
	actionButton.TextColor3 = Color3.fromRGB(255, 255, 255)
	actionButton.TextSize = 13
	actionButton.Text = text
	actionButton.Parent = parent
	applyCorner(actionButton)
	return actionButton
end

local headerBar = Instance.new("Frame")
headerBar.Size = UDim2.new(1, 0, 0, 36)
headerBar.BackgroundColor3 = HEADER_COLOR
headerBar.BorderSizePixel = 0
headerBar.Parent = root

local titleLabel = Instance.new("TextLabel")
titleLabel.Size = UDim2.new(0, 180, 1, 0)
titleLabel.Position = UDim2.new(0, 12, 0, 0)
titleLabel.BackgroundTransparency = 1
titleLabel.Font = Enum.Font.GothamBold
titleLabel.Text = "RoSync"
titleLabel.TextColor3 = TEXT_PRIMARY
titleLabel.TextSize = 18
titleLabel.TextXAlignment = Enum.TextXAlignment.Left
titleLabel.Parent = headerBar

local statusDot = Instance.new("Frame")
statusDot.Size = UDim2.new(0, 12, 0, 12)
statusDot.AnchorPoint = Vector2.new(1, 0.5)
statusDot.Position = UDim2.new(1, -10, 0.5, 0)
statusDot.BorderSizePixel = 0
statusDot.BackgroundColor3 = STATUS_DISCONNECTED
statusDot.Parent = headerBar

local statusDotCorner = Instance.new("UICorner")
statusDotCorner.CornerRadius = UDim.new(1, 0)
statusDotCorner.Parent = statusDot

local controlsFrame = Instance.new("Frame")
controlsFrame.Size = UDim2.new(1, -24, 0, 80)
controlsFrame.Position = UDim2.new(0, 12, 0, 48)
controlsFrame.BackgroundTransparency = 1
controlsFrame.Parent = root

local connectToggleButton = createButton(
	controlsFrame,
	"▶ Connect",
	CONNECT_BLUE,
	UDim2.new(0, 0, 0, 0),
	UDim2.new(1, 0, 0, 34)
)

local rowFrame = Instance.new("Frame")
rowFrame.Size = UDim2.new(1, 0, 0, 34)
rowFrame.Position = UDim2.new(0, 0, 0, 46)
rowFrame.BackgroundTransparency = 1
rowFrame.Parent = controlsFrame

local rowLayout = Instance.new("UIListLayout")
rowLayout.FillDirection = Enum.FillDirection.Horizontal
rowLayout.Padding = UDim.new(0, 8)
rowLayout.Parent = rowFrame

local pushAllButton = createButton(
	rowFrame,
	"↑ Push All",
	PUSH_ORANGE,
	UDim2.new(),
	UDim2.new(1/3, -6, 1, 0)
)
local pullAllButton = createButton(
	rowFrame,
	"↓ Pull All",
	PULL_PURPLE,
	UDim2.new(),
	UDim2.new(1/3, -5, 1, 0)
)
local statusButton = createButton(
	rowFrame,
	"≡ Status",
	STATUS_GRAY,
	UDim2.new(),
	UDim2.new(1/3, -5, 1, 0)
)

local logFeed = Instance.new("Frame")
logFeed.Size = UDim2.new(1, -24, 1, -140)
logFeed.Position = UDim2.new(0, 12, 0, 140)
logFeed.BackgroundColor3 = PANEL_COLOR
logFeed.BorderSizePixel = 0
logFeed.Parent = root
applyCorner(logFeed)

local logStroke = Instance.new("UIStroke")
logStroke.Color = PANEL_BORDER
logStroke.Thickness = 1
logStroke.Transparency = 0.15
logStroke.Parent = logFeed

local logScrollFrame = Instance.new("ScrollingFrame")
logScrollFrame.Size = UDim2.new(1, 0, 1, 0)
logScrollFrame.BackgroundTransparency = 1
logScrollFrame.BorderSizePixel = 0
logScrollFrame.AutomaticCanvasSize = Enum.AutomaticSize.Y
logScrollFrame.CanvasSize = UDim2.new(1, 0, 0, 0)
logScrollFrame.ScrollBarThickness = 4
logScrollFrame.ScrollBarImageColor3 = Color3.fromRGB(100, 116, 139)
logScrollFrame.Parent = logFeed

local logLayout = Instance.new("UIListLayout")
logLayout.Padding = UDim.new(0, 6)
logLayout.Parent = logScrollFrame

local logPadding = Instance.new("UIPadding")
logPadding.PaddingTop = UDim.new(0, 10)
logPadding.PaddingBottom = UDim.new(0, 10)
logPadding.PaddingLeft = UDim.new(0, 10)
logPadding.PaddingRight = UDim.new(0, 10)
logPadding.Parent = logScrollFrame

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
local statusMode = "disconnected"
local suppressNextSocketCloseOutput = false

local function daemonIndexedInstanceCount(statusResponse)
	if type(statusResponse) ~= "table" then
		return nil
	end

	local summary = statusResponse.summary
	if type(summary) == "table" and type(summary.indexedInstances) == "number" then
		return summary.indexedInstances
	end

	local runtime = statusResponse.runtime
	if type(runtime) == "table" and type(runtime.summary) == "table" and type(runtime.summary.indexedInstances) == "number" then
		return runtime.summary.indexedInstances
	end

	return nil
end

local function writeStudioOutput(message, level)
	local formatted = "[RoSync] " .. tostring(message)
	if level == "error" then
		warn(formatted)
	else
		print(formatted)
	end
end

local function originLabel(origin)
	if origin == "studio" then
		return "Studio"
	elseif origin == "editor" then
		return "VSCode"
	end

	return "Disk"
end

local function parentPathOf(pathValue)
	if type(pathValue) ~= "string" then
		return ""
	end

	local segments = string.split(pathValue, "/")
	if #segments <= 1 then
		return ""
	end

	table.remove(segments, #segments)
	return table.concat(segments, "/")
end

local function classifyPathMutation(oldPath, newPath)
	if parentPathOf(oldPath) ~= parentPathOf(newPath) then
		return "move"
	end

	return "rename"
end

local function scrollLogToBottom()
	task.defer(function()
		local maxPosition = math.max(0, logScrollFrame.AbsoluteCanvasSize.Y - logScrollFrame.AbsoluteWindowSize.Y)
		logScrollFrame.CanvasPosition = Vector2.new(0, maxPosition)
	end)
end

local function appendLogEntry(richText, plainText, level)
	local entry = Instance.new("TextLabel")
	entry.Size = UDim2.new(1, -2, 0, 0)
	entry.AutomaticSize = Enum.AutomaticSize.Y
	entry.BackgroundTransparency = 1
	entry.Font = Enum.Font.Code
	entry.RichText = true
	entry.Text = richText
	entry.TextColor3 = TEXT_PRIMARY
	entry.TextSize = 12
	entry.TextWrapped = true
	entry.TextXAlignment = Enum.TextXAlignment.Left
	entry.TextYAlignment = Enum.TextYAlignment.Top
	entry.Parent = logScrollFrame

	scrollLogToBottom()
end

local function appendInfo(message, level)
	local isError = level == "warn" or level == "error"
	local prefix = isError and EVENT_PREFIX.error or EVENT_PREFIX.info
	local prefixColor = isError and EVENT_COLOR.error or EVENT_COLOR.info
	local messageColor = isError and EVENT_COLOR.error or EVENT_COLOR.path
	local richText = string.format(
		'<font color="%s"><b>%s</b></font> <font color="%s">%s</font>',
		prefixColor,
		escapeRichText(prefix),
		messageColor,
		escapeRichText(message)
	)
	local plainText = string.format("%s %s", prefix, tostring(message))
	appendLogEntry(richText, plainText, level)
end

local function appendEvent(origin, action, pathValue, extraPath)
	local eventType = EVENT_PREFIX[action] and action or "update"
	local source = originLabel(origin)
	local actionText = EVENT_PREFIX[eventType]
	local actionColor = EVENT_COLOR[eventType] or EVENT_COLOR.update
	local fullPath = extraPath and (tostring(pathValue) .. " → " .. tostring(extraPath)) or tostring(pathValue)
	local richText = string.format(
		'<font color="%s"><b>%s</b></font> <font color="%s">[%s]</font> <font color="%s">%s</font>',
		actionColor,
		escapeRichText(actionText),
		EVENT_COLOR.source,
		escapeRichText(source),
		EVENT_COLOR.path,
		escapeRichText(fullPath)
	)
	local plainText = string.format("%s [%s] %s", actionText, source, fullPath)
	appendLogEntry(richText, plainText)
end

local appendLog = appendInfo

local function refreshConnectToggle()
	if desiredConnection then
		connectToggleButton.BackgroundColor3 = DISCONNECT_RED
		connectToggleButton.Text = "⏹ Disconnect"
		return
	end

	connectToggleButton.BackgroundColor3 = CONNECT_BLUE
	connectToggleButton.Text = "▶ Connect"
end

local function setStatus(mode)
	statusMode = mode

	if mode == "connected" then
		statusDot.BackgroundColor3 = STATUS_CONNECTED
		return
	end

	if mode == "reconnecting" then
		statusDot.BackgroundColor3 = STATUS_RECONNECTING
		return
	end

	if mode == "conflict" then
		statusDot.BackgroundColor3 = STATUS_CONFLICT
		return
	end

	statusDot.BackgroundColor3 = STATUS_DISCONNECTED
end

task.spawn(function()
	while widget.Parent ~= nil do
		setStatus(statusMode)
		refreshConnectToggle()
		task.wait(2)
	end
end)

local function appendSyncBlocked()
	appendInfo("Sync blocked — stop playtest first", "warn")
end

local function isSyncAllowed(actionLabel)
	if Listener.isSyncAllowed() then
		return true
	end

	appendInfo((actionLabel or "Sync") .. " is disabled while Studio is running. Stop playtest and try again.", "warn")
	return false
end

local function shouldSyncInstance(instance)
	return Listener.shouldSyncInstance(instance, function(target)
		return target ~= nil and target ~= game and not applyInProgress
	end)
end

local function safeGetChildren(instance)
	local success, children = pcall(function()
		return instance:GetChildren()
	end)
	return (success and type(children) == "table") and children or {}
end

local function serializeSyncTree(instance)
	if not shouldSyncInstance(instance) then
		return nil
	end

	local serialized = Serializer.serializeInstance(instance, false)
	serialized.children = {}

	for _, child in ipairs(safeGetChildren(instance)) do
		local childSerialized = serializeSyncTree(child)
		if childSerialized then
			table.insert(serialized.children, childSerialized)
		end
	end

	return serialized
end

local function currentServerUrl()
	return DEFAULT_SERVER_URL
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

local function instanceExistsAtPath(pathValue)
	if type(pathValue) ~= "string" or pathValue == "" then
		return false
	end

	local segments = {}
	for segment in string.gmatch(pathValue, "[^/]+") do
		table.insert(segments, segment)
	end

	if #segments == 0 then
		return false
	end

	local success, current = pcall(function()
		return game:GetService(segments[1])
	end)
	if not success or not current then
		return false
	end

	for index = 2, #segments do
		current = current:FindFirstChild(segments[index])
		if not current then
			return false
		end
	end

	return true
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

local function syncAfterHandshake()
	httpClient:setBaseUrl(currentServerUrl())

	local statusOk, statusResponse = httpClient:request("GET", "/status")
	if statusOk then
		local indexedInstances = daemonIndexedInstanceCount(statusResponse)
		if indexedInstances == 0 then
			appendInfo("Daemon has 0 indexed instances — pulling Studio state to disk instead of applying empty daemon state.")
			pushServices()
			return
		end
	elseif statusResponse ~= nil then
		appendInfo("Status check failed during connect: " .. tostring(statusResponse), "warn")
	end

	fetchAndApplyTree("welcome")
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
	setStatus("reconnecting")
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
		appendInfo("Daemon handshake complete. Studio is now connected over WebSocket.")
		syncAfterHandshake()
		return
	end

	if payload.type == "PROJECT_TREE" and type(payload.tree) == "table" then
		applyInProgress = true
		local applied, applyError = Deserializer.applyTree(payload.tree)
		applyInProgress = false

		if applied then
			appendInfo("Applied daemon project tree.")
		else
			appendInfo("Project tree apply failed: " .. tostring(applyError), "warn")
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
		local existedBefore = instanceExistsAtPath(payload.path)
		applyInProgress = true
		local applied, applyError = Deserializer.applySyncInstance(payload.path, payload.data)
		applyInProgress = false

		if applied then
			appendEvent(payload.origin, existedBefore and "update" or "add", payload.path)
		else
			appendInfo("Sync apply failed for " .. payload.path .. ": " .. tostring(applyError), "warn")
		end
		return
	end

	if payload.type == "REMOVE_INSTANCE" and type(payload.path) == "string" then
		applyInProgress = true
		local removed, removeError = Deserializer.removeAtPath(payload.path)
		applyInProgress = false

		if removed then
			appendEvent(payload.origin, "remove", payload.path)
		else
			appendInfo("Remove failed for " .. payload.path .. ": " .. tostring(removeError), "warn")
		end
		return
	end

	if payload.type == "RENAME_INSTANCE" and type(payload.oldPath) == "string" and type(payload.newPath) == "string" then
		applyInProgress = true
		local renamed, renameError = Deserializer.renameAtPath(payload.oldPath, payload.newPath)
		applyInProgress = false

		if renamed then
			appendEvent(payload.origin, classifyPathMutation(payload.oldPath, payload.newPath), payload.oldPath, payload.newPath)
		else
			appendInfo("Rename failed for " .. payload.oldPath .. ": " .. tostring(renameError), "warn")
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
		setStatus("conflict")
		appendInfo("Conflict: " .. tostring(payload.reason or payload.path), "warn")
		return
	end

	if payload.type == "ERROR" then
		appendInfo("Daemon error: " .. tostring(payload.message), "warn")
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
				setStatus("disconnected")
				appendLog(
					wasConnected and "WebSocket closed. Falling back to HTTP polling."
						or "WebSocket closed before the daemon handshake completed. Falling back to HTTP polling.",
					"warn"
				)
				if not suppressNextSocketCloseOutput then
					writeStudioOutput("Connection lost from RoSync daemon.")
				end
				suppressNextSocketCloseOutput = false
				startPolling("socket-closed")
				scheduleReconnect()
				return
			end
			stopPolling()
			setStatus("disconnected")
			appendLog("WebSocket closed.")
			if not suppressNextSocketCloseOutput then
				writeStudioOutput("Connection lost from RoSync daemon.")
			end
			suppressNextSocketCloseOutput = false
		end,
	})

	local connected, errorMessage = socketClient:connect()
	if not connected then
		socketClient = nil
		appendLog("WebSocket connect failed: " .. tostring(errorMessage), "warn")
		appendConnectionHint()
		setStatus("disconnected")
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

	setStatus("connected")
	appendLog("Connected to RoSync daemon at " .. currentServerUrl() .. ".")
	writeStudioOutput("Connection established with RoSync daemon at " .. currentServerUrl() .. ".")
	return true
end

local function pushInstance(instance, action, shouldLogEvent)
	local serialized = serializeSyncTree(instance)
	if not serialized then
		return false
	end

	local instancePath = PathUtil.getInstancePath(instance)
	local sent = sendMessage({
		type = "SYNC_INSTANCE",
		path = instancePath,
		data = serialized,
	})

	if sent and shouldLogEvent then
		appendEvent("studio", action or "update", instancePath)
	end

	return sent
end

pushServices = function()
	if not isSyncAllowed("Push All") then
		return
	end

	local pushedCount = 0

	for _, serviceName in ipairs(SERVICE_NAMES) do
		local success, service = pcall(function()
			return game:GetService(serviceName)
		end)

		if success and service then
			pushInstance(service, "update", false)
			pushedCount += 1
		end
	end

	appendLog("Pushed " .. tostring(pushedCount) .. " top-level services to the daemon.")
end

local function startWatch()
	if not isSyncAllowed("Watch") then
		return
	end

	if stopWatching then
		appendLog("Watch is already running.")
		return
	end

	stopWatching = Listener.attach(function(instance)
		return instance ~= nil and instance ~= game and not applyInProgress
	end, {
		onAdded = function(instance)
			pushInstance(instance, "add", true)
		end,
		onChanged = function(instance)
			pushInstance(instance, "update", true)
		end,
		onRenamed = function(instance, oldPath, newPath)
			local serialized = Serializer.serializeInstance(instance, true)
			local sent = sendMessage({
				type = "INSTANCE_RENAMED",
				oldPath = oldPath,
				newPath = newPath,
				data = serialized,
			})
			if sent then
				appendEvent("studio", classifyPathMutation(oldPath, newPath), oldPath, newPath)
			end
		end,
		onRemoving = function(_, previousPath)
			local sent = sendMessage({
				type = "REMOVE_INSTANCE",
				path = previousPath,
			})
			if sent then
				appendEvent("studio", "remove", previousPath)
			end
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

local function disconnectFromDaemon()
	desiredConnection = false
	refreshConnectToggle()
	cancelReconnect()
	stopPolling()
	stopWatch()
	if socketClient then
		suppressNextSocketCloseOutput = true
		socketClient:close()
		socketClient = nil
	end
	setStatus("disconnected")
	appendLog("Disconnected from RoSync.")
	writeStudioOutput("Connection lost from RoSync daemon.")
end

connectToggleButton.MouseButton1Click:Connect(function()
	if desiredConnection then
		disconnectFromDaemon()
		return
	end

	httpClient:setBaseUrl(currentServerUrl())
	desiredConnection = true
	refreshConnectToggle()
	startWatch()

	local success, response = httpClient:getHealth()
	if success then
		appendLog(
			"HTTP health OK for " .. currentServerUrl() .. " (project " .. tostring(response.project or "unknown") .. "). Opening WebSocket..."
		)
		connectSocket(false)
	else
		setStatus("disconnected")
		appendLog("HTTP health failed: " .. tostring(response), "warn")
		appendConnectionHint()
		startPolling("health-check")
		scheduleReconnect()
	end
end)

pushAllButton.MouseButton1Click:Connect(function()
	if not Listener.isSyncAllowed() then
		appendSyncBlocked()
		return
	end

	pushServices()
end)

pullAllButton.MouseButton1Click:Connect(function()
	if not Listener.isSyncAllowed() then
		appendSyncBlocked()
		return
	end

	sendMessage({
		type = "PULL_REQUEST",
	})
end)

statusButton.MouseButton1Click:Connect(function()
	httpClient:setBaseUrl(currentServerUrl())
	local success, response = httpClient:request("GET", "/status")
	if success then
		local connections = response.connections or {}
		local summary = response.summary or {}
		appendLog(
			"Status: project="
				.. tostring(response.project or response.config and response.config.projectName or "unknown")
				.. ", studio="
				.. tostring(connections.studio or 0)
				.. ", editor="
				.. tostring(connections.editor or 0)
				.. ", instances="
				.. tostring(summary.indexedInstances or 0)
		)
	else
		appendLog("Status failed: " .. tostring(response), "warn")
	end
end)

button.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)

refreshConnectToggle()
setStatus("disconnected")
appendLog("RoSync plugin ready.")
writeStudioOutput("RoSync plugin ready.")
