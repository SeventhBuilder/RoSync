local HttpService = game:GetService("HttpService")

local HttpClient = require(script.Parent.network.HttpClient)
local WebSocketClient = require(script.Parent.network.WebSocketClient)
local Deserializer = require(script.Parent.sync.Deserializer)
local Listener = require(script.Parent.sync.Listener)
local Serializer = require(script.Parent.sync.Serializer)
local PathUtil = require(script.Parent.util.PathUtil)

local DEFAULT_SERVER_URL = "http://127.0.0.1:34872"
local SYNC_SERVICES = {
	"Workspace",
	"Players",
	"Lighting",
	"MaterialService",
	"ReplicatedFirst",
	"ReplicatedStorage",
	"ServerScriptService",
	"ServerStorage",
	"StarterGui",
	"StarterPack",
	"StarterPlayer",
	"Teams",
	"SoundService",
	"TextChatService",
}
local SYNC_SERVICE_SET = {}
local READ_ONLY_SYNC_PATHS = {
	["Workspace/Camera"] = true,
	["Workspace/Terrain"] = true,
}

for _, serviceName in ipairs(SYNC_SERVICES) do
	SYNC_SERVICE_SET[serviceName] = true
end

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
controlsFrame.Size = UDim2.new(1, -24, 0, 116)
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

local transferFrame = Instance.new("Frame")
transferFrame.Size = UDim2.new(1, 0, 0, 26)
transferFrame.Position = UDim2.new(0, 0, 0, 90)
transferFrame.BackgroundColor3 = PANEL_COLOR
transferFrame.BorderSizePixel = 0
transferFrame.Parent = controlsFrame
applyCorner(transferFrame)

local transferStroke = Instance.new("UIStroke")
transferStroke.Color = PANEL_BORDER
transferStroke.Thickness = 1
transferStroke.Transparency = 0.15
transferStroke.Parent = transferFrame

local transferAccent = Instance.new("Frame")
transferAccent.Size = UDim2.new(0, 4, 1, 0)
transferAccent.BackgroundColor3 = STATUS_GRAY
transferAccent.BorderSizePixel = 0
transferAccent.Parent = transferFrame

local transferAccentCorner = Instance.new("UICorner")
transferAccentCorner.CornerRadius = UDim.new(0, 6)
transferAccentCorner.Parent = transferAccent

local transferTitleLabel = Instance.new("TextLabel")
transferTitleLabel.Size = UDim2.new(0, 132, 1, 0)
transferTitleLabel.Position = UDim2.new(0, 14, 0, 0)
transferTitleLabel.BackgroundTransparency = 1
transferTitleLabel.Font = Enum.Font.GothamMedium
transferTitleLabel.Text = "Idle"
transferTitleLabel.TextColor3 = TEXT_PRIMARY
transferTitleLabel.TextSize = 12
transferTitleLabel.TextXAlignment = Enum.TextXAlignment.Left
transferTitleLabel.Parent = transferFrame

local transferDetailLabel = Instance.new("TextLabel")
transferDetailLabel.Size = UDim2.new(1, -156, 1, 0)
transferDetailLabel.Position = UDim2.new(0, 146, 0, 0)
transferDetailLabel.BackgroundTransparency = 1
transferDetailLabel.Font = Enum.Font.Code
transferDetailLabel.Text = "Connect to start syncing."
transferDetailLabel.TextColor3 = Color3.fromRGB(148, 163, 184)
transferDetailLabel.TextSize = 11
transferDetailLabel.TextXAlignment = Enum.TextXAlignment.Left
transferDetailLabel.Parent = transferFrame

local logFeed = Instance.new("Frame")
logFeed.Size = UDim2.new(1, -24, 1, -188)
logFeed.Position = UDim2.new(0, 12, 0, 176)
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
local pushAll
local statusMode = "disconnected"
local suppressNextSocketCloseOutput = false
local serviceManifestCache = {}
local dirtyServiceNames = {}

for _, serviceName in ipairs(SYNC_SERVICES) do
	dirtyServiceNames[serviceName] = true
end

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

local function isScriptClassName(className)
	return className == "Script" or className == "LocalScript" or className == "ModuleScript"
end

local function shouldLogIncomingUpdate(payload)
	return type(payload) == "table"
		and type(payload.data) == "table"
		and isScriptClassName(payload.data.className)
end

local function shouldLogStudioUpdate(instance, propertyName)
	return instance ~= nil
		and instance:IsA("LuaSourceContainer")
		and propertyName == "Source"
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

local function setTransferState(title, detail, accentColor)
	transferTitleLabel.Text = tostring(title or "Idle")
	transferDetailLabel.Text = tostring(detail or "")
	transferAccent.BackgroundColor3 = accentColor or STATUS_GRAY
end

local function resetTransferState()
	if desiredConnection then
		setTransferState("Ready", "Waiting for the next sync request.", STATUS_CONNECTED)
		return
	end

	setTransferState("Idle", "Connect to start syncing.", STATUS_GRAY)
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

local function serviceNameFromPath(pathValue)
	if type(pathValue) ~= "string" or pathValue == "" then
		return nil
	end

	local slashIndex = string.find(pathValue, "/", 1, true)
	if slashIndex then
		return string.sub(pathValue, 1, slashIndex - 1)
	end

	return pathValue
end

local function serviceNameFromInstance(instance)
	local current = instance
	while current and current.Parent ~= game and current.Parent ~= nil do
		current = current.Parent
	end

	if current and SYNC_SERVICE_SET[current.Name] == true then
		return current.Name
	end

	return nil
end

local function markServiceManifestDirty(serviceName)
	if type(serviceName) ~= "string" or SYNC_SERVICE_SET[serviceName] ~= true then
		return
	end

	dirtyServiceNames[serviceName] = true
	serviceManifestCache[serviceName] = nil
end

local function markPathDirty(pathValue)
	markServiceManifestDirty(serviceNameFromPath(pathValue))
end

local function markInstanceDirty(instance)
	markServiceManifestDirty(serviceNameFromInstance(instance))
end

local function invalidateAllServiceManifests()
	for _, serviceName in ipairs(SYNC_SERVICES) do
		markServiceManifestDirty(serviceName)
	end
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

local function sendPullProgress(progress)
	if type(progress) ~= "table" or type(progress.service) ~= "string" then
		return false
	end

	if not socketClient or not socketClient:isConnected() then
		return false
	end

	return sendMessage({
		type = "PULL_PROGRESS",
		service = progress.service,
		done = progress.done,
		total = progress.total,
		serviceComplete = progress.serviceComplete == true,
		pullComplete = progress.pullComplete == true,
	})
end

local function sendSyncPlan(plan)
	if type(plan) ~= "table" or type(plan.direction) ~= "string" or type(plan.service) ~= "string" then
		return false
	end

	if not socketClient or not socketClient:isConnected() then
		return false
	end

	return sendMessage({
		type = "SYNC_PLAN",
		direction = plan.direction,
		service = plan.service,
		added = plan.added,
		changed = plan.changed,
		removed = plan.removed,
		unchanged = plan.unchanged,
		scanned = plan.scanned,
		serviceIndex = plan.serviceIndex,
		serviceCount = plan.serviceCount,
		planComplete = plan.planComplete == true,
	})
end

local function sendSyncStage(stage)
	if type(stage) ~= "table" or type(stage.direction) ~= "string" or type(stage.phase) ~= "string" then
		return false
	end

	if not socketClient or not socketClient:isConnected() then
		return false
	end

	return sendMessage({
		type = "SYNC_STAGE",
		direction = stage.direction,
		phase = stage.phase,
		service = stage.service,
		serviceIndex = stage.serviceIndex,
		serviceCount = stage.serviceCount,
		detail = stage.detail,
	})
end

local function serializePushBatchInstance(instance)
	local serialized = Serializer.serializeInstance(instance, false)
	serialized.children = serialized.children or {}

	if instance ~= nil and instance.Parent == game then
		serialized.children = {}
		for _, child in ipairs(safeGetChildren(instance)) do
			if shouldSyncInstance(child) then
				table.insert(serialized.children, Serializer.serializeInstance(child, false))
			end
		end
	end

	return serialized
end

local function copySortedTags(tags)
	local sorted = {}
	for _, tag in ipairs(tags or {}) do
		if type(tag) == "string" then
			table.insert(sorted, tag)
		end
	end
	table.sort(sorted)
	return sorted
end

local function shallowNodeSnapshot(node)
	if type(node) ~= "table" then
		return nil
	end

	return {
		className = node.className,
		properties = node.properties or {},
		attributes = node.attributes or {},
		tags = copySortedTags(node.tags),
		source = node.source,
	}
end

local function isSequentialArray(value)
	if type(value) ~= "table" then
		return false
	end

	local count = 0
	for key in pairs(value) do
		if type(key) ~= "number" then
			return false
		end
		count += 1
	end

	for index = 1, count do
		if value[index] == nil then
			return false
		end
	end

	return true
end

local function valuesEquivalent(left, right)
	if left == right then
		return true
	end

	local leftType = type(left)
	if leftType ~= type(right) then
		return false
	end

	if leftType ~= "table" then
		return false
	end

	local leftIsArray = isSequentialArray(left)
	local rightIsArray = isSequentialArray(right)
	if leftIsArray or rightIsArray then
		if not leftIsArray or not rightIsArray or #left ~= #right then
			return false
		end

		for index, leftValue in ipairs(left) do
			if not valuesEquivalent(leftValue, right[index]) then
				return false
			end
		end

		return true
	end

	local seenKeys = {}
	for key, leftValue in pairs(left) do
		seenKeys[key] = true
		if not valuesEquivalent(leftValue, right[key]) then
			return false
		end
	end

	for key, rightValue in pairs(right) do
		if not seenKeys[key] and rightValue ~= nil then
			return false
		end
	end

	return true
end

local function indexRemoteTreeNode(node, snapshotIndex)
	if type(node) ~= "table" or type(node.path) ~= "string" then
		return
	end

	snapshotIndex[node.path] = shallowNodeSnapshot(node)
	for _, childNode in ipairs(node.children or {}) do
		indexRemoteTreeNode(childNode, snapshotIndex)
	end
end

local function buildRemoteTreeSnapshotIndex(tree)
	local snapshotIndex = {}
	if type(tree) ~= "table" or type(tree.services) ~= "table" then
		return snapshotIndex
	end

	for _, serviceNode in ipairs(tree.services) do
		indexRemoteTreeNode(serviceNode, snapshotIndex)
	end

	return snapshotIndex
end

local function buildRemoteServicePathIndex(tree)
	local servicePathIndex = {}
	if type(tree) ~= "table" or type(tree.services) ~= "table" then
		return servicePathIndex
	end

	local function visit(node, serviceName)
		if type(node) ~= "table" or type(node.path) ~= "string" then
			return
		end

		local nextServiceName = serviceName or node.path
		local pathSet = servicePathIndex[nextServiceName]
		if type(pathSet) ~= "table" then
			pathSet = {}
			servicePathIndex[nextServiceName] = pathSet
		end

		pathSet[node.path] = true
		for _, childNode in ipairs(node.children or {}) do
			visit(childNode, nextServiceName)
		end
	end

	for _, serviceNode in ipairs(tree.services) do
		visit(serviceNode, nil)
	end

	return servicePathIndex
end

local function countPathDepth(pathValue)
	local depth = 1
	for _ in string.gmatch(pathValue, "/") do
		depth += 1
	end
	return depth
end

local function isSameOrDescendantPath(candidatePath, ancestorPath)
	return candidatePath == ancestorPath or string.sub(candidatePath, 1, #ancestorPath + 1) == ancestorPath .. "/"
end

local function isProtectedSyncPath(pathValue)
	for protectedPath in pairs(READ_ONLY_SYNC_PATHS) do
		if isSameOrDescendantPath(pathValue, protectedPath) then
			return true
		end
	end

	return false
end

local function collectServiceInstances(serviceName)
	local service = game:FindService(serviceName)
	local instances = {}
	if not service then
		return instances
	end

	for _, descendant in ipairs(service:GetDescendants()) do
		if shouldSyncInstance(descendant) then
			table.insert(instances, descendant)
		end
	end

	if shouldSyncInstance(service) then
		table.insert(instances, 1, service)
	end

	return instances
end

local function buildLocalServiceManifest(serviceName)
	local instances = collectServiceInstances(serviceName)
	local manifest = {
		scanned = #instances,
		pathSet = {},
		snapshotIndex = {},
		pullPathSet = {},
		pullSnapshotIndex = {},
		instanceByPath = {},
	}

	for index, instance in ipairs(instances) do
		local instancePath = PathUtil.getInstancePath(instance)
		local serialized = serializePushBatchInstance(instance)
		local snapshot = shallowNodeSnapshot(serialized)

		manifest.pathSet[instancePath] = true
		manifest.snapshotIndex[instancePath] = snapshot
		manifest.instanceByPath[instancePath] = instance

		if not isProtectedSyncPath(instancePath) then
			manifest.pullPathSet[instancePath] = true
			manifest.pullSnapshotIndex[instancePath] = snapshot
		end

		if index % 200 == 0 then
			task.wait()
		end
	end

	return manifest
end

local function getLocalServiceManifest(serviceName)
	local cachedManifest = serviceManifestCache[serviceName]
	if cachedManifest ~= nil and dirtyServiceNames[serviceName] ~= true then
		return cachedManifest
	end

	local manifest = buildLocalServiceManifest(serviceName)
	serviceManifestCache[serviceName] = manifest
	dirtyServiceNames[serviceName] = false
	return manifest
end

local function selectServiceRemovalPaths(serviceName, localPathSet, remoteServicePathIndex)
	local removalPaths = {}
	if type(remoteServicePathIndex) ~= "table" then
		return removalPaths
	end

	local remotePathSet = remoteServicePathIndex[serviceName]
	if type(remotePathSet) ~= "table" then
		return removalPaths
	end

	local missingPaths = {}
	for remotePath in pairs(remotePathSet) do
		if remotePath ~= serviceName and localPathSet[remotePath] ~= true then
			table.insert(missingPaths, remotePath)
		end
	end

	table.sort(missingPaths, function(left, right)
		local depthDifference = countPathDepth(left) - countPathDepth(right)
		if depthDifference ~= 0 then
			return depthDifference < 0
		end
		return left < right
	end)

	local selectedPaths = {}
	for _, remotePath in ipairs(missingPaths) do
		local covered = false
		for _, selectedPath in ipairs(selectedPaths) do
			if isSameOrDescendantPath(remotePath, selectedPath) then
				covered = true
				break
			end
		end

		if not covered then
			table.insert(selectedPaths, remotePath)
			table.insert(removalPaths, remotePath)
		end
	end

	return removalPaths
end

local function selectStudioRemovalPaths(serviceName, localPathSet, remoteServicePathIndex)
	local removalPaths = {}
	local remotePathSet = type(remoteServicePathIndex) == "table" and remoteServicePathIndex[serviceName] or nil
	if type(remotePathSet) ~= "table" then
		return removalPaths
	end

	local missingPaths = {}
	for localPath in pairs(localPathSet) do
		if localPath ~= serviceName and remotePathSet[localPath] ~= true then
			table.insert(missingPaths, localPath)
		end
	end

	table.sort(missingPaths, function(left, right)
		local depthDifference = countPathDepth(left) - countPathDepth(right)
		if depthDifference ~= 0 then
			return depthDifference < 0
		end
		return left < right
	end)

	local selectedPaths = {}
	for _, localPath in ipairs(missingPaths) do
		local covered = false
		for _, selectedPath in ipairs(selectedPaths) do
			if isSameOrDescendantPath(localPath, selectedPath) then
				covered = true
				break
			end
		end

		if not covered then
			table.insert(selectedPaths, localPath)
			table.insert(removalPaths, localPath)
		end
	end

	return removalPaths
end

local function summarizePushServicePlan(serviceName, remoteSnapshotIndex, remoteServicePathIndex)
	local manifest = getLocalServiceManifest(serviceName)
	local entries = {}
	local addedCount = 0
	local changedCount = 0
	local scannedCount = 0

	for instancePath, localSnapshot in pairs(manifest.snapshotIndex) do
		scannedCount += 1
		local remoteSnapshot = type(remoteSnapshotIndex) == "table" and remoteSnapshotIndex[instancePath] or nil
		if not valuesEquivalent(localSnapshot, remoteSnapshot) then
			local instance = manifest.instanceByPath[instancePath]
			local serialized = instance and serializePushBatchInstance(instance) or nil
			if serialized then
				table.insert(entries, {
					path = instancePath,
					data = serialized,
				})
				if type(remoteSnapshot) == "table" then
					changedCount += 1
				else
					addedCount += 1
				end
			end
		end
		if scannedCount % 200 == 0 then
			task.wait()
		end
	end

	local removalPaths = selectServiceRemovalPaths(serviceName, manifest.pathSet, remoteServicePathIndex)
	return {
		name = serviceName,
		scanned = manifest.scanned,
		added = addedCount,
		changed = changedCount,
		removed = #removalPaths,
		unchanged = math.max(0, manifest.scanned - addedCount - changedCount),
		entries = entries,
		removalPaths = removalPaths,
	}
end

local function summarizePullServicePlan(serviceName, remoteSnapshotIndex, remoteServicePathIndex)
	local manifest = getLocalServiceManifest(serviceName)
	local remotePathSet = type(remoteServicePathIndex) == "table" and remoteServicePathIndex[serviceName] or nil
	local addedCount = 0
	local changedCount = 0
	local unchangedCount = 0

	local scannedRemoteCount = 0
	for remotePath in pairs(remotePathSet or {}) do
		if not isProtectedSyncPath(remotePath) then
			local localSnapshot = manifest.pullSnapshotIndex[remotePath]
			local remoteSnapshot = type(remoteSnapshotIndex) == "table" and remoteSnapshotIndex[remotePath] or nil
			if localSnapshot == nil then
				addedCount += 1
			elseif not valuesEquivalent(localSnapshot, remoteSnapshot) then
				changedCount += 1
			else
				unchangedCount += 1
			end
		end
		scannedRemoteCount += 1
		if scannedRemoteCount % 200 == 0 then
			task.wait()
		end
	end

	local removalPaths = selectStudioRemovalPaths(serviceName, manifest.pullPathSet, remoteServicePathIndex)
	return {
		name = serviceName,
		scanned = manifest.scanned,
		added = addedCount,
		changed = changedCount,
		removed = #removalPaths,
		unchanged = unchangedCount,
		removalPaths = removalPaths,
	}
end

local function appendServicePlan(direction, plan)
	local serviceName = plan.name or plan.service or "Service"
	if (plan.added or 0) == 0 and (plan.changed or 0) == 0 and (plan.removed or 0) == 0 then
		appendInfo(
			string.format(
				"%s plan for %s - no changes (%d unchanged).",
				direction == "push" and "Push" or "Pull",
				serviceName,
				plan.unchanged or 0
			)
		)
		return
	end

	appendInfo(
		string.format(
			"%s plan for %s - %d added, %d changed, %d removed, %d unchanged.",
			direction == "push" and "Push" or "Pull",
			serviceName,
			plan.added or 0,
			plan.changed or 0,
			plan.removed or 0,
			plan.unchanged or 0
		)
	)
end

local function broadcastServicePlan(direction, plan, serviceIndex, serviceCount)
	appendServicePlan(direction, plan)
	sendSyncPlan({
		direction = direction,
		service = plan.name,
		added = plan.added or 0,
		changed = plan.changed or 0,
		removed = plan.removed or 0,
		unchanged = plan.unchanged or 0,
		scanned = plan.scanned or 0,
		serviceIndex = serviceIndex,
		serviceCount = serviceCount,
		planComplete = serviceIndex == serviceCount,
	})
end

local function fetchAndApplyTree(reason, options)
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

	local applyOptions = nil
	local shouldLogProgress = type(options) == "table" and options.logProgress == true
	local shouldReconcileRemovals = type(options) == "table" and options.reconcileRemovals == true
	local remoteSnapshotIndex = nil
	local remoteServicePathIndex = nil
	if type(response.tree) == "table" then
		remoteSnapshotIndex = buildRemoteTreeSnapshotIndex(response.tree)
		remoteServicePathIndex = buildRemoteServicePathIndex(response.tree)
	end

	if shouldLogProgress or shouldReconcileRemovals then
		setTransferState("Planning Pull", "Comparing Studio state against disk.", PULL_PURPLE)
		appendInfo("Building Pull All plan service by service...")
		for serviceIndex, serviceName in ipairs(SYNC_SERVICES) do
			local planningDetail = string.format("Comparing %s (%d/%d).", serviceName, serviceIndex, #SYNC_SERVICES)
			setTransferState("Planning Pull " .. tostring(serviceName), planningDetail, PULL_PURPLE)
			appendInfo(string.format("Planning Pull for %s (%d/%d)...", serviceName, serviceIndex, #SYNC_SERVICES))
			sendSyncStage({
				direction = "pull",
				phase = "planning",
				service = serviceName,
				serviceIndex = serviceIndex,
				serviceCount = #SYNC_SERVICES,
				detail = "Comparing Studio state against disk.",
			})
			local plan = summarizePullServicePlan(serviceName, remoteSnapshotIndex, remoteServicePathIndex)
			broadcastServicePlan("pull", plan, serviceIndex, #SYNC_SERVICES)
			task.wait()
		end
		appendInfo("Pull plan ready. Applying disk state to Studio...")
	end

	if shouldLogProgress or shouldReconcileRemovals then
		local serviceCount = #(response.tree.services or {})
		applyOptions = {
			reconcileRemovals = shouldReconcileRemovals,
			batchSize = 50,
			onProgress = function(done, total)
				setTransferState("Pulling", string.format("%d/%d instances applied to Studio", done, total), PULL_PURPLE)
			end,
			onServiceStart = function(serviceName, total)
				setTransferState("Pulling " .. tostring(serviceName), string.format("0/%d instances applied to Studio", total), PULL_PURPLE)
				appendInfo(string.format("Pulling %s (%d instances)...", serviceName, total))
				sendSyncStage({
					direction = "pull",
					phase = "applying",
					service = serviceName,
					detail = "Applying disk state to Studio.",
				})
				sendPullProgress({
					service = serviceName,
					done = 0,
					total = total,
					serviceComplete = false,
					pullComplete = false,
				})
			end,
			onServiceProgress = function(serviceName, done, total)
				setTransferState("Pulling " .. tostring(serviceName), string.format("%d/%d instances applied to Studio", done, total), PULL_PURPLE)
				sendPullProgress({
					service = serviceName,
					done = done,
					total = total,
					serviceComplete = false,
					pullComplete = false,
				})
			end,
			onServiceComplete = function(serviceName, done, total, isLastService, removedCount)
				local pullComplete = isLastService == true or serviceCount <= 1
				local detailText = string.format("%d/%d instances applied to Studio", done, total)
				if type(removedCount) == "number" and removedCount > 0 then
					detailText = detailText .. string.format(" + %d removed", removedCount)
				end

				setTransferState("Pulling " .. tostring(serviceName), detailText, PULL_PURPLE)
				if type(removedCount) == "number" and removedCount > 0 then
					appendInfo(string.format("Pulled %s (%d applied, %d removed).", serviceName, done, removedCount))
				else
					appendInfo(string.format("Pulled %s (%d instances).", serviceName, done))
				end
				sendPullProgress({
					service = serviceName,
					done = done,
					total = total,
					serviceComplete = true,
					pullComplete = pullComplete,
				})
			end,
		}
	end

	applyInProgress = true
	local applied, applyError, appliedCount, removedCount = Deserializer.applyTree(response.tree, applyOptions)
	applyInProgress = false
	invalidateAllServiceManifests()

	if applied and shouldLogProgress then
		if type(removedCount) == "number" and removedCount > 0 then
			appendInfo(string.format("Pull All complete - %d instances applied, %d removed", appliedCount or 0, removedCount))
			setTransferState(
				"Ready",
				string.format("Pulled %d instances into Studio and removed %d stale instances.", appliedCount or 0, removedCount),
				STATUS_CONNECTED
			)
		else
			appendInfo(string.format("Pull All complete - %d instances applied", appliedCount or 0))
			setTransferState("Ready", string.format("Pulled %d instances into Studio.", appliedCount or 0), STATUS_CONNECTED)
		end
	elseif applied and reason ~= "poll" then
		appendLog("Applied daemon tree (" .. tostring(reason) .. ").")
	elseif not applied then
		appendLog("Tree apply failed (" .. tostring(reason) .. "): " .. tostring(applyError), "warn")
		setTransferState("Needs Attention", tostring(applyError or "Tree apply failed."), STATUS_CONFLICT)
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
	resetTransferState()

	local statusOk, statusResponse = httpClient:request("GET", "/status")
	if statusOk then
		local indexedInstances = daemonIndexedInstanceCount(statusResponse)
		if indexedInstances == 0 then
			appendInfo("Daemon has 0 indexed instances — pulling Studio state to disk instead of applying empty daemon state.")
			pushAll()
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
		invalidateAllServiceManifests()

		if applied then
			appendInfo("Applied daemon project tree.")
		else
			appendInfo("Project tree apply failed: " .. tostring(applyError), "warn")
		end
		return
	end

	if payload.type == "PUSH_REQUEST" then
		fetchAndApplyTree("push-request", {
			logProgress = true,
			reconcileRemovals = true,
		})
		return
	end

	if payload.type == "PULL_REQUEST" then
		pushAll()
		return
	end

	if payload.type == "SYNC_INSTANCE" and type(payload.path) == "string" and type(payload.data) == "table" then
		local existedBefore = instanceExistsAtPath(payload.path)
		applyInProgress = true
		local applied, applyError = Deserializer.applySyncInstance(payload.path, payload.data)
		applyInProgress = false
		markPathDirty(payload.path)

		if applied then
			if existedBefore then
				if shouldLogIncomingUpdate(payload) then
					appendEvent(payload.origin, "update", payload.path)
				end
			else
				appendEvent(payload.origin, "add", payload.path)
			end
		else
			appendInfo("Sync apply failed for " .. payload.path .. ": " .. tostring(applyError), "warn")
		end
		return
	end

	if payload.type == "REMOVE_INSTANCE" and type(payload.path) == "string" then
		applyInProgress = true
		local removed, removeError = Deserializer.removeAtPath(payload.path)
		applyInProgress = false
		markPathDirty(payload.path)

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
		markPathDirty(payload.oldPath)
		markPathDirty(payload.newPath)

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

local function pushInstance(instance, action, shouldLogEvent, propertyName)
	markInstanceDirty(instance)
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

	if sent and shouldLogEvent and (action ~= "update" or shouldLogStudioUpdate(instance, propertyName)) then
		appendEvent("studio", action or "update", instancePath)
	end

	return sent
end

local function flushPushBatch(batch, removedPaths, progress)
	local normalizedBatch = batch or {}
	local normalizedRemovedPaths = removedPaths or {}
	if #normalizedBatch == 0 and #normalizedRemovedPaths == 0 then
		return true
	end

	local payload = {
		type = "PUSH_BATCH",
		instances = normalizedBatch,
		removedPaths = normalizedRemovedPaths,
	}

	if type(progress) == "table" then
		payload.service = progress.service
		payload.done = progress.done
		payload.total = progress.total
		payload.serviceComplete = progress.serviceComplete == true
		payload.pushComplete = progress.pushComplete == true
	end

	return sendMessage(payload)
end

pushAll = function()
	if not isSyncAllowed("Push All") then
		return
	end

	if not socketClient or not socketClient:isConnected() then
		appendInfo("Push All requires an active daemon connection.", "warn")
		return
	end

	appendInfo("Starting Push All...")
	setTransferState("Planning Push", "Comparing Studio state against disk.", PUSH_ORANGE)
	httpClient:setBaseUrl(currentServerUrl())

	local remoteSnapshotIndex = nil
	local remoteServicePathIndex = nil
	local treeOk, treeResponse = httpClient:getTree()
	if treeOk and type(treeResponse) == "table" and type(treeResponse.tree) == "table" then
		remoteSnapshotIndex = buildRemoteTreeSnapshotIndex(treeResponse.tree)
		remoteServicePathIndex = buildRemoteServicePathIndex(treeResponse.tree)
		appendInfo("Comparing Studio state with the daemon tree before Push All.")
	else
		appendInfo("Daemon tree compare failed. Falling back to full Push All.", "warn")
	end

	local batchSize = 50
	local scannedTotal = 0
	local addedTotal = 0
	local changedTotal = 0
	local removedTotal = 0
	local servicePlans = {}
	appendInfo("Building Push All plan service by service...")

	for serviceIndex, serviceName in ipairs(SYNC_SERVICES) do
		local planningDetail = string.format("Comparing %s (%d/%d).", serviceName, serviceIndex, #SYNC_SERVICES)
		setTransferState("Planning Push " .. tostring(serviceName), planningDetail, PUSH_ORANGE)
		appendInfo(string.format("Planning Push for %s (%d/%d)...", serviceName, serviceIndex, #SYNC_SERVICES))
		sendSyncStage({
			direction = "push",
			phase = "planning",
			service = serviceName,
			serviceIndex = serviceIndex,
			serviceCount = #SYNC_SERVICES,
			detail = "Comparing Studio state against disk.",
		})
		local plan = summarizePushServicePlan(serviceName, remoteSnapshotIndex, remoteServicePathIndex)
		broadcastServicePlan("push", plan, serviceIndex, #SYNC_SERVICES)
		scannedTotal += plan.scanned
		addedTotal += plan.added
		changedTotal += plan.changed
		removedTotal += plan.removed
		if #plan.entries > 0 or #plan.removalPaths > 0 then
			table.insert(servicePlans, plan)
		end
		task.wait()
	end

	if #servicePlans == 0 then
		appendInfo(string.format("Push All already matches disk - no changed instances found across %d checked entries.", scannedTotal))
		setTransferState("Ready", "Studio already matches disk.", STATUS_CONNECTED)
		return
	end

	appendInfo("Push plan ready. Exporting Studio changes to disk...")

	for serviceIndex, plan in ipairs(servicePlans) do
		local serviceName = plan.name
		local entries = plan.entries
		local removalPaths = plan.removalPaths
		local differenceCount = #entries + #removalPaths
		sendSyncStage({
			direction = "push",
			phase = "applying",
			service = serviceName,
			serviceIndex = serviceIndex,
			serviceCount = #servicePlans,
			detail = "Exporting Studio changes to disk.",
		})
		appendInfo(
			string.format(
				"Pushing %s (%d added, %d changed, %d removed of %d checked)...",
				serviceName,
				plan.added,
				plan.changed,
				#removalPaths,
				plan.scanned
			)
		)
		setTransferState("Pushing " .. tostring(serviceName), string.format("0/%d changes exported to disk", differenceCount), PUSH_ORANGE)

		local processedCount = 0
		local batch = {}
		for index, entry in ipairs(entries) do
			table.insert(batch, entry)

			if #batch >= batchSize or index == #entries then
				local nextDone = processedCount + #batch
				setTransferState(
					"Pushing " .. tostring(serviceName),
					string.format("%d/%d changes exported to disk", nextDone, differenceCount),
					PUSH_ORANGE
				)
				local sent = flushPushBatch(batch, {}, {
					service = serviceName,
					done = nextDone,
					total = differenceCount,
					serviceComplete = nextDone == differenceCount,
					pushComplete = nextDone == differenceCount and serviceIndex == #servicePlans,
				})
				if not sent then
					appendInfo("Push All batch send failed.", "warn")
				end

				processedCount = nextDone
				batch = {}
				task.wait(0.05)
			end
		end

		local removalBatch = {}
		for index, removalPath in ipairs(removalPaths) do
			table.insert(removalBatch, removalPath)

			if #removalBatch >= batchSize or index == #removalPaths then
				local nextDone = processedCount + #removalBatch
				setTransferState(
					"Pushing " .. tostring(serviceName),
					string.format("%d/%d changes exported to disk", nextDone, differenceCount),
					PUSH_ORANGE
				)
				local sent = flushPushBatch({}, removalBatch, {
					service = serviceName,
					done = nextDone,
					total = differenceCount,
					serviceComplete = nextDone == differenceCount,
					pushComplete = nextDone == differenceCount and serviceIndex == #servicePlans,
				})
				if not sent then
					appendInfo("Push All removal batch send failed.", "warn")
				end

				processedCount = nextDone
				removalBatch = {}
				task.wait(0.05)
			end
		end

		appendInfo(
			string.format(
				"%s - pushed %d added, %d changed, and removed %d stale instances",
				serviceName,
				plan.added,
				plan.changed,
				#removalPaths
			)
		)
	end

	appendInfo(
		string.format(
			"Push All complete - %d added, %d changed, and %d stale instances removed after checking %d total instances",
			addedTotal,
			changedTotal,
			removedTotal,
			scannedTotal
		)
	)
	setTransferState(
		"Ready",
		string.format("Applied %d Studio changes into the daemon.", addedTotal + changedTotal + removedTotal),
		STATUS_CONNECTED
	)
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
			markInstanceDirty(instance)
			pushInstance(instance, "add", true)
		end,
		onChanged = function(instance, propertyName)
			markInstanceDirty(instance)
			pushInstance(instance, "update", true, propertyName)
		end,
		onRenamed = function(instance, oldPath, newPath)
			markPathDirty(oldPath)
			markPathDirty(newPath)
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
			markPathDirty(previousPath)
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
	resetTransferState()
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
	setTransferState("Connecting", "Checking daemon health on localhost.", CONNECT_BLUE)
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

	pushAll()
end)

pullAllButton.MouseButton1Click:Connect(function()
	if not Listener.isSyncAllowed() then
		appendSyncBlocked()
		return
	end

	appendInfo("Starting Pull All...")
	setTransferState("Pulling", "Requesting the daemon tree.", PULL_PURPLE)
	fetchAndApplyTree("pull-all", {
		logProgress = true,
		reconcileRemovals = true,
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
resetTransferState()
appendLog("RoSync plugin ready.")
writeStudioOutput("RoSync plugin ready.")
