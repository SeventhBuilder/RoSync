local RunService = game:GetService("RunService")
local PathUtil = require(script.Parent.Parent.util.PathUtil)

local Listener = {}
local DEFAULT_DEBOUNCE_SECONDS = 0.15

local READ_ONLY_INSTANCES = {
	["Workspace/Camera"] = true,
}

local BLOCKED_SERVICES = {
	CoreGui = true,
	RobloxPluginGuiService = true,
	PluginGuiService = true,
	CorePackages = true,
	StudioService = true,
	ScriptEditorService = true,
	PluginDebugService = true,
	PluginPoliciesService = true,
	UserInputService = true,
	GuiService = true,
	NetworkClient = true,
	NetworkServer = true,
	RobloxReplicatedStorage = true,
	FriendService = true,
	MarketplaceService = true,
	AnalyticsService = true,
	VoiceChatService = true,
	PolicyService = true,
	HttpRbxApiService = true,
	NotificationService = true,
	BadgeService = true,
	KeyframeSequenceProvider = true,
}

local function isRuntimePlayerInstance(instance)
	local parent = instance.Parent
	if parent and parent.ClassName == "Players" then
		return instance:IsA("Player")
	end

	return false
end

local function isBlockedService(instance)
	local current = instance
	while current.Parent ~= game and current.Parent ~= nil do
		current = current.Parent
	end

	return BLOCKED_SERVICES[current.Name] == true or BLOCKED_SERVICES[current.ClassName] == true
end

function Listener.isReadOnlyInstance(instance)
	if instance == nil then
		return false
	end

	return READ_ONLY_INSTANCES[PathUtil.getInstancePath(instance)] == true
end

function Listener.isSyncAllowed()
	return not RunService:IsRunning()
end

function Listener.shouldSyncInstance(instance, shouldSync)
	if instance == nil or instance == game then
		return false
	end

	if not Listener.isSyncAllowed() then
		return false
	end

	if isBlockedService(instance) then
		return false
	end

	if isRuntimePlayerInstance(instance) then
		return false
	end

	if type(shouldSync) == "function" then
		return shouldSync(instance)
	end

	return true
end

function Listener.attach(shouldSync, callbacks, options)
	local connections = {}
	local changedConnections = {}
	local nameChangedConnections = {}
	local lastKnownPaths = {}
	local pendingThreads = {}

	local debounceSeconds = DEFAULT_DEBOUNCE_SECONDS
	if type(options) == "table" and type(options.debounceSeconds) == "number" then
		debounceSeconds = options.debounceSeconds
	end

	local function cancelPending(instance)
		local thread = pendingThreads[instance]
		if thread then
			task.cancel(thread)
			pendingThreads[instance] = nil
		end
	end

	local function disconnectChanged(instance)
		cancelPending(instance)
		local existing = changedConnections[instance]
		if existing then
			existing:Disconnect()
			changedConnections[instance] = nil
		end
		local nameChanged = nameChangedConnections[instance]
		if nameChanged then
			nameChanged:Disconnect()
			nameChangedConnections[instance] = nil
		end
	end

	local function scheduleChanged(instance)
		cancelPending(instance)

		pendingThreads[instance] = task.delay(debounceSeconds, function()
			pendingThreads[instance] = nil
			local currentPath = PathUtil.getInstancePath(instance)
			if not Listener.shouldSyncInstance(instance, shouldSync) then
				lastKnownPaths[instance] = currentPath
				return
			end

			local previousPath = lastKnownPaths[instance]

			if previousPath and currentPath ~= previousPath and callbacks.onRenamed then
				callbacks.onRenamed(instance, previousPath, currentPath)
			elseif callbacks.onChanged then
				callbacks.onChanged(instance)
			end

			lastKnownPaths[instance] = currentPath
		end)
	end

	local function connectInstance(instance)
		if not Listener.isSyncAllowed() then
			return
		end

		if changedConnections[instance] or nameChangedConnections[instance] then
			return
		end

		lastKnownPaths[instance] = PathUtil.getInstancePath(instance)
		changedConnections[instance] = instance.Changed:Connect(function(propertyName)
			if propertyName == "Name" then
				return
			end
			scheduleChanged(instance)
		end)
		nameChangedConnections[instance] = instance:GetPropertyChangedSignal("Name"):Connect(function()
			if not Listener.isSyncAllowed() then
				return
			end

			local previousPath = lastKnownPaths[instance]
			local currentPath = PathUtil.getInstancePath(instance)
			lastKnownPaths[instance] = currentPath

			if not previousPath or previousPath == currentPath then
				return
			end

			if not Listener.shouldSyncInstance(instance, shouldSync) then
				return
			end

			if callbacks.onRenamed then
				callbacks.onRenamed(instance, previousPath, currentPath)
			end
		end)
	end

	local function unwatchInstance(instance)
		disconnectChanged(instance)
		lastKnownPaths[instance] = nil
	end

	local function onAdded(instance)
		lastKnownPaths[instance] = PathUtil.getInstancePath(instance)
		if Listener.shouldSyncInstance(instance, shouldSync) and callbacks.onAdded then
			callbacks.onAdded(instance)
		end
		connectInstance(instance)
	end

	local function onRemoving(instance)
		local previousPath = lastKnownPaths[instance] or PathUtil.getInstancePath(instance)
		if Listener.shouldSyncInstance(instance, shouldSync) and callbacks.onRemoving then
			callbacks.onRemoving(instance, previousPath)
		end
		unwatchInstance(instance)
	end

	for _, descendant in ipairs(game:GetDescendants()) do
		connectInstance(descendant)
	end

	table.insert(connections, game.DescendantAdded:Connect(onAdded))
	table.insert(connections, game.DescendantRemoving:Connect(onRemoving))

	return function()
		for _, connection in ipairs(connections) do
			connection:Disconnect()
		end
		for instance, connection in pairs(changedConnections) do
			connection:Disconnect()
			changedConnections[instance] = nil
		end
		for instance, connection in pairs(nameChangedConnections) do
			connection:Disconnect()
			nameChangedConnections[instance] = nil
		end
		for instance, pendingThread in pairs(pendingThreads) do
			task.cancel(pendingThread)
			pendingThreads[instance] = nil
		end
		for instance in pairs(lastKnownPaths) do
			lastKnownPaths[instance] = nil
		end
	end
end

return Listener
