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

local SURFACE_COLOR = Color3.fromRGB(26, 32, 43)
local PANEL_COLOR = Color3.fromRGB(18, 23, 33)
local PANEL_BORDER = Color3.fromRGB(45, 56, 74)
local TEXT_PRIMARY = Color3.fromRGB(241, 245, 249)
local TEXT_SECONDARY = Color3.fromRGB(148, 163, 184)
local STATUS_OFFLINE = Color3.fromRGB(211, 74, 74)
local STATUS_WARN = Color3.fromRGB(234, 179, 8)
local STATUS_ONLINE = Color3.fromRGB(34, 197, 94)

local EVENT_COLOR = {
	add = "rgb(34,197,94)",
	update = "rgb(234,179,8)",
	remove = "rgb(239,68,68)",
	rename = "rgb(234,179,8)",
	info = "rgb(148,163,184)",
	error = "rgb(248,113,113)",
	time = "rgb(100,116,139)",
	source = "rgb(148,163,184)",
	path = "rgb(241,245,249)",
}

local EVENT_PREFIX = {
	add = "+ Add",
	update = "~ Update",
	remove = "- Remove",
	rename = "~ Rename",
	info = ".",
	error = "!",
}

local ACTION_BUTTON_STYLES = {
	Connect = Color3.fromRGB(37, 99, 235),
	["Start Watch"] = Color3.fromRGB(22, 163, 74),
	["Push All"] = Color3.fromRGB(234, 88, 12),
	["Pull All"] = Color3.fromRGB(8, 145, 178),
	["Push Selection"] = Color3.fromRGB(124, 58, 237),
	Status = Color3.fromRGB(71, 85, 105),
	Refresh = Color3.fromRGB(79, 70, 229),
	Disconnect = Color3.fromRGB(220, 38, 38),
}

local function escapeRichText(value)
	value = string.gsub(tostring(value), "&", "&amp;")
	value = string.gsub(value, "<", "&lt;")
	value = string.gsub(value, ">", "&gt;")
	return value
end

local function lightenColor(color, amount)
	return Color3.new(
		math.clamp(color.R + amount, 0, 1),
		math.clamp(color.G + amount, 0, 1),
		math.clamp(color.B + amount, 0, 1)
	)
end

local root = Instance.new("ScrollingFrame")
root.Size = UDim2.fromScale(1, 1)
root.BackgroundColor3 = Color3.fromRGB(14, 19, 28)
root.BorderSizePixel = 0
root.CanvasSize = UDim2.new(1, 0, 0, 0)
root.AutomaticCanvasSize = Enum.AutomaticSize.Y
root.ScrollBarThickness = 6
root.ScrollBarImageColor3 = Color3.fromRGB(71, 85, 105)
root.Parent = widget

local listLayout = Instance.new("UIListLayout")
listLayout.Padding = UDim.new(0, 10)
listLayout.Parent = root

local padding = Instance.new("UIPadding")
padding.PaddingTop = UDim.new(0, 12)
padding.PaddingBottom = UDim.new(0, 12)
padding.PaddingLeft = UDim.new(0, 12)
padding.PaddingRight = UDim.new(0, 12)
padding.Parent = root

local function createCard(height)
	local card = Instance.new("Frame")
	card.Size = UDim2.new(1, -6, 0, height)
	card.BackgroundColor3 = SURFACE_COLOR
	card.BorderSizePixel = 0
	card.Parent = root

	local stroke = Instance.new("UIStroke")
	stroke.Color = PANEL_BORDER
	stroke.Thickness = 1
	stroke.Transparency = 0.2
	stroke.Parent = card

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 10)
	corner.Parent = card

	return card
end

local function createInset(parent, height)
	local frame = Instance.new("Frame")
	frame.Size = UDim2.new(1, 0, 0, height)
	frame.BackgroundColor3 = PANEL_COLOR
	frame.BorderSizePixel = 0
	frame.Parent = parent

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 8)
	corner.Parent = frame

	return frame
end

local function createLegendChip(parent, labelText, rgbText)
	local chip = Instance.new("Frame")
	chip.Size = UDim2.new(0, 86, 0, 24)
	chip.BackgroundColor3 = Color3.fromRGB(31, 41, 55)
	chip.BorderSizePixel = 0
	chip.Parent = parent

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 999)
	corner.Parent = chip

	local label = Instance.new("TextLabel")
	label.Size = UDim2.new(1, -16, 1, 0)
	label.Position = UDim2.new(0, 8, 0, 0)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.GothamMedium
	label.Text = labelText
	label.TextColor3 = TEXT_PRIMARY
	label.TextSize = 12
	label.RichText = true
	label.TextXAlignment = Enum.TextXAlignment.Center
	label.Parent = chip

	label.Text = string.format('<font color="%s">%s</font>', rgbText, escapeRichText(labelText))
	return chip
end

local function createServerField(parent, labelText, defaultValue)
	local label = Instance.new("TextLabel")
	label.Size = UDim2.new(1, -24, 0, 18)
	label.Position = UDim2.new(0, 12, 0, 10)
	label.BackgroundTransparency = 1
	label.Text = labelText
	label.TextColor3 = TEXT_SECONDARY
	label.Font = Enum.Font.GothamMedium
	label.TextSize = 12
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.Parent = parent

	local input = Instance.new("TextBox")
	input.Size = UDim2.new(1, -24, 0, 34)
	input.Position = UDim2.new(0, 12, 0, 30)
	input.BackgroundColor3 = Color3.fromRGB(31, 41, 55)
	input.BorderSizePixel = 0
	input.ClearTextOnFocus = false
	input.Text = defaultValue
	input.TextColor3 = TEXT_PRIMARY
	input.Font = Enum.Font.Code
	input.TextSize = 13
	input.TextXAlignment = Enum.TextXAlignment.Left
	input.Parent = parent

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 8)
	corner.Parent = input

	local inputPadding = Instance.new("UIPadding")
	inputPadding.PaddingLeft = UDim.new(0, 10)
	inputPadding.PaddingRight = UDim.new(0, 10)
	inputPadding.Parent = input

	return input
end

local function createButtonGrid(parent, labels)
	local container = Instance.new("Frame")
	container.Size = UDim2.new(1, -24, 0, 74)
	container.Position = UDim2.new(0, 12, 0, 14)
	container.BackgroundTransparency = 1
	container.Parent = parent

	local layout = Instance.new("UIGridLayout")
	layout.CellPadding = UDim2.new(0, 8, 0, 8)
	layout.CellSize = UDim2.new(0.25, -6, 0, 32)
	layout.Parent = container

	local buttons = {}
	for _, labelText in ipairs(labels) do
		local baseColor = ACTION_BUTTON_STYLES[labelText] or Color3.fromRGB(59, 130, 246)
		local actionButton = Instance.new("TextButton")
		actionButton.Text = labelText
		actionButton.TextColor3 = Color3.fromRGB(255, 255, 255)
		actionButton.TextSize = 13
		actionButton.Font = Enum.Font.GothamMedium
		actionButton.AutoButtonColor = false
		actionButton.BackgroundColor3 = baseColor
		actionButton.BorderSizePixel = 0
		actionButton.Parent = container

		local corner = Instance.new("UICorner")
		corner.CornerRadius = UDim.new(0, 8)
		corner.Parent = actionButton

		actionButton.MouseEnter:Connect(function()
			actionButton.BackgroundColor3 = lightenColor(baseColor, 0.05)
		end)

		actionButton.MouseLeave:Connect(function()
			actionButton.BackgroundColor3 = baseColor
		end)

		buttons[labelText] = actionButton
	end

	return buttons
end

local headerCard = createCard(82)
local headerAccent = Instance.new("Frame")
headerAccent.Size = UDim2.new(0, 4, 1, -18)
headerAccent.Position = UDim2.new(0, 12, 0, 9)
headerAccent.BackgroundColor3 = Color3.fromRGB(59, 130, 246)
headerAccent.BorderSizePixel = 0
headerAccent.Parent = headerCard

local headerAccentCorner = Instance.new("UICorner")
headerAccentCorner.CornerRadius = UDim.new(0, 999)
headerAccentCorner.Parent = headerAccent

local titleLabel = Instance.new("TextLabel")
titleLabel.Size = UDim2.new(1, -168, 0, 26)
titleLabel.Position = UDim2.new(0, 24, 0, 12)
titleLabel.BackgroundTransparency = 1
titleLabel.Font = Enum.Font.GothamBold
titleLabel.Text = "RoSync"
titleLabel.TextColor3 = TEXT_PRIMARY
titleLabel.TextSize = 20
titleLabel.TextXAlignment = Enum.TextXAlignment.Left
titleLabel.Parent = headerCard

local subtitleLabel = Instance.new("TextLabel")
subtitleLabel.Size = UDim2.new(1, -168, 0, 30)
subtitleLabel.Position = UDim2.new(0, 24, 0, 40)
subtitleLabel.BackgroundTransparency = 1
subtitleLabel.Font = Enum.Font.Gotham
subtitleLabel.Text = "Live Studio, VS Code, and daemon sync with a readable event stream."
subtitleLabel.TextWrapped = true
subtitleLabel.TextColor3 = TEXT_SECONDARY
subtitleLabel.TextSize = 12
subtitleLabel.TextXAlignment = Enum.TextXAlignment.Left
subtitleLabel.TextYAlignment = Enum.TextYAlignment.Top
subtitleLabel.Parent = headerCard

local statusPill = Instance.new("Frame")
statusPill.Size = UDim2.new(0, 126, 0, 30)
statusPill.Position = UDim2.new(1, -138, 0, 14)
statusPill.BackgroundColor3 = Color3.fromRGB(69, 24, 24)
statusPill.BorderSizePixel = 0
statusPill.Parent = headerCard

local statusPillCorner = Instance.new("UICorner")
statusPillCorner.CornerRadius = UDim.new(0, 999)
statusPillCorner.Parent = statusPill

local statusLabel = Instance.new("TextLabel")
statusLabel.Size = UDim2.fromScale(1, 1)
statusLabel.BackgroundTransparency = 1
statusLabel.Font = Enum.Font.GothamMedium
statusLabel.Text = "Disconnected"
statusLabel.TextColor3 = TEXT_PRIMARY
statusLabel.TextSize = 12
statusLabel.Parent = statusPill

local serverCard = createCard(74)
local serverUrlBox = createServerField(serverCard, "Server URL", DEFAULT_SERVER_URL)

local controlsCard = createCard(126)
local buttons = createButtonGrid(controlsCard, { "Connect", "Start Watch", "Push All", "Pull All", "Push Selection", "Status", "Refresh", "Disconnect" })

local selectionLabel = Instance.new("TextLabel")
selectionLabel.Size = UDim2.new(1, -24, 0, 28)
selectionLabel.Position = UDim2.new(0, 12, 0, 96)
selectionLabel.BackgroundTransparency = 1
selectionLabel.Font = Enum.Font.Code
selectionLabel.Text = "Selection: none"
selectionLabel.TextColor3 = TEXT_SECONDARY
selectionLabel.TextSize = 12
selectionLabel.TextWrapped = true
selectionLabel.TextXAlignment = Enum.TextXAlignment.Left
selectionLabel.TextYAlignment = Enum.TextYAlignment.Top
selectionLabel.Parent = controlsCard

local logCard = createCard(360)

local logTitle = Instance.new("TextLabel")
logTitle.Size = UDim2.new(1, -24, 0, 20)
logTitle.Position = UDim2.new(0, 12, 0, 10)
logTitle.BackgroundTransparency = 1
logTitle.Font = Enum.Font.GothamBold
logTitle.Text = "Sync Activity"
logTitle.TextColor3 = TEXT_PRIMARY
logTitle.TextSize = 14
logTitle.TextXAlignment = Enum.TextXAlignment.Left
logTitle.Parent = logCard

local legendRow = Instance.new("Frame")
legendRow.Size = UDim2.new(1, -24, 0, 24)
legendRow.Position = UDim2.new(0, 12, 0, 36)
legendRow.BackgroundTransparency = 1
legendRow.Parent = logCard

local legendLayout = Instance.new("UIListLayout")
legendLayout.FillDirection = Enum.FillDirection.Horizontal
legendLayout.Padding = UDim.new(0, 8)
legendLayout.Parent = legendRow

createLegendChip(legendRow, "+ Add", EVENT_COLOR.add)
createLegendChip(legendRow, "~ Update", EVENT_COLOR.update)
createLegendChip(legendRow, "- Remove", EVENT_COLOR.remove)

local logFeed = createInset(logCard, 278)
logFeed.Position = UDim2.new(0, 12, 0, 70)

local logScrollFrame = Instance.new("ScrollingFrame")
logScrollFrame.Size = UDim2.new(1, 0, 1, 0)
logScrollFrame.BackgroundTransparency = 1
logScrollFrame.BorderSizePixel = 0
logScrollFrame.AutomaticCanvasSize = Enum.AutomaticSize.Y
logScrollFrame.CanvasSize = UDim2.new(1, 0, 0, 0)
logScrollFrame.ScrollBarThickness = 6
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

local function writeOutput(message, level)
	local formatted = "[RoSync Plugin] " .. tostring(message)
	if level == "warn" or level == "error" then
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

local function shouldAutoScrollLog()
	local maxPosition = math.max(0, logScrollFrame.AbsoluteCanvasSize.Y - logScrollFrame.AbsoluteWindowSize.Y)
	return maxPosition <= 0 or logScrollFrame.CanvasPosition.Y >= (maxPosition - 28)
end

local function scrollLogToBottom()
	task.defer(function()
		local maxPosition = math.max(0, logScrollFrame.AbsoluteCanvasSize.Y - logScrollFrame.AbsoluteWindowSize.Y)
		logScrollFrame.CanvasPosition = Vector2.new(0, maxPosition)
	end)
end

local function appendLogEntry(richText, plainText, level)
	local stayPinned = shouldAutoScrollLog()

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

	writeOutput(plainText, level)

	if stayPinned then
		scrollLogToBottom()
	end
end

local function appendInfo(message, level)
	local timestamp = os.date("%H:%M:%S")
	local isError = level == "warn" or level == "error"
	local prefix = isError and EVENT_PREFIX.error or EVENT_PREFIX.info
	local prefixColor = isError and EVENT_COLOR.error or EVENT_COLOR.info
	local messageColor = isError and EVENT_COLOR.error or EVENT_COLOR.path
	local richText = string.format(
		'<font color="%s"><b>%s</b></font> <font color="%s">[%s]</font> <font color="%s">%s</font>',
		prefixColor,
		escapeRichText(prefix),
		EVENT_COLOR.time,
		escapeRichText(timestamp),
		messageColor,
		escapeRichText(message)
	)
	local plainText = string.format("[%s] %s", timestamp, tostring(message))
	appendLogEntry(richText, plainText, level)
end

local function appendEvent(origin, action, pathValue, extraPath)
	local timestamp = os.date("%H:%M:%S")
	local eventType = EVENT_PREFIX[action] and action or "update"
	local source = originLabel(origin)
	local actionText = EVENT_PREFIX[eventType]
	local actionColor = EVENT_COLOR[eventType] or EVENT_COLOR.update
	local fullPath = extraPath and (tostring(pathValue) .. " -> " .. tostring(extraPath)) or tostring(pathValue)
	local richText = string.format(
		'<font color="%s">[%s]</font> <font color="%s">[%s]</font> <font color="%s"><b>%s</b></font> <font color="%s">%s</font>',
		EVENT_COLOR.time,
		escapeRichText(timestamp),
		EVENT_COLOR.source,
		escapeRichText(source),
		actionColor,
		escapeRichText(actionText),
		EVENT_COLOR.path,
		escapeRichText(fullPath)
	)
	local plainText = string.format("[%s] [%s] %s %s", timestamp, source, actionText, fullPath)
	appendLogEntry(richText, plainText)
end

local appendLog = appendInfo

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

local function setStatus(text, color)
	statusLabel.Text = text
	statusPill.BackgroundColor3 = color
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
			appendEvent(payload.origin, "rename", payload.oldPath, payload.newPath)
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
		setStatus("Conflict", STATUS_WARN)
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
				setStatus("Polling", STATUS_WARN)
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
			setStatus("Disconnected", STATUS_OFFLINE)
			appendLog("WebSocket closed.")
		end,
	})

	local connected, errorMessage = socketClient:connect()
	if not connected then
		socketClient = nil
		appendLog("WebSocket connect failed: " .. tostring(errorMessage), "warn")
		appendConnectionHint()
		setStatus("Polling", STATUS_WARN)
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

	setStatus("Connected", STATUS_ONLINE)
	appendLog("Connected to RoSync daemon at " .. currentServerUrl() .. ".")
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
	if not isSyncAllowed("Start Watch") then
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
				type = "RENAME_INSTANCE",
				oldPath = oldPath,
				newPath = newPath,
				data = serialized,
			})
			if sent then
				appendEvent("studio", "rename", oldPath, newPath)
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

buttons.Connect.MouseButton1Click:Connect(function()
	httpClient:setBaseUrl(currentServerUrl())
	desiredConnection = true
	local success, response = httpClient:getHealth()
	if success then
		setStatus("Connecting...", STATUS_WARN)
		appendLog(
			"HTTP health OK for " .. currentServerUrl() .. " (project " .. tostring(response.project or "unknown") .. "). Opening WebSocket..."
		)
		connectSocket(false)
	else
		setStatus("Polling", STATUS_WARN)
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
	if not isSyncAllowed("Pull All") then
		return
	end

	sendMessage({
		type = "PULL_REQUEST",
	})
end)

buttons["Push Selection"].MouseButton1Click:Connect(function()
	if not isSyncAllowed("Push Selection") then
		return
	end

	local selected = refreshSelection()
	if selected then
		pushInstance(selected, "update", true)
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
	setStatus("Disconnected", STATUS_OFFLINE)
	appendLog("Disconnected from RoSync.")
end)

Selection.SelectionChanged:Connect(refreshSelection)

button.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)

refreshSelection()
appendLog("RoSync plugin ready. The live activity feed below is scrollable, and Studio Output still mirrors these entries.")
