local RunService = game:GetService("RunService")
local PathUtil = require(script.Parent.Parent.util.PathUtil)

local Listener = {}
local DEBOUNCE_MS = {
	default = 150,
	script = 1500,
	camera = 99999,
}

local READ_ONLY_INSTANCES = {
	["Workspace/Camera"] = true,
}

local ALLOWED_ROOT_SERVICES = {
	Workspace = true,
	Players = true,
	Lighting = true,
	MaterialService = true,
	ReplicatedFirst = true,
	ReplicatedStorage = true,
	ServerScriptService = true,
	ServerStorage = true,
	StarterGui = true,
	StarterPack = true,
	StarterPlayer = true,
	Teams = true,
	SoundService = true,
	TextChatService = true,
}

local function topLevelAncestor(instance)
	local current = instance
	while current and current.Parent ~= game and current.Parent ~= nil do
		current = current.Parent
	end

	return current
end

local function isAllowedRootService(instance)
	local root = topLevelAncestor(instance)
	if root == nil then
		return false
	end

	return ALLOWED_ROOT_SERVICES[root.Name] == true
end

local function isRuntimePlayerInstance(instance)
	local current = instance
	while current and current ~= game do
		if current:IsA("Player") then
			return true
		end
		current = current.Parent
	end

	return false
end

local function getDebounceMs(instance, propertyName)
	if instance:IsA("LuaSourceContainer") and propertyName == "Source" then
		return DEBOUNCE_MS.script
	end

	if instance.ClassName == "Camera" then
		return DEBOUNCE_MS.camera
	end

	return DEBOUNCE_MS.default
end

local function safeReadSource(instance)
	local success, value = pcall(function()
		return instance.Source
	end)

	if success and type(value) == "string" then
		return value
	end

	return nil
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

	if not isAllowedRootService(instance) then
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
	local pendingProperties = {}
	local lastSentSource = {}

	local function cancelPending(instance)
		local thread = pendingThreads[instance]
		if thread then
			task.cancel(thread)
			pendingThreads[instance] = nil
		end
		pendingProperties[instance] = nil
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

	local function scheduleChanged(instance, propertyName)
		cancelPending(instance)
		pendingProperties[instance] = propertyName

		pendingThreads[instance] = task.delay(getDebounceMs(instance, propertyName) / 1000, function()
			pendingThreads[instance] = nil
			local pendingProperty = pendingProperties[instance]
			pendingProperties[instance] = nil
			local currentPath = PathUtil.getInstancePath(instance)
			if not Listener.shouldSyncInstance(instance, shouldSync) then
				lastKnownPaths[instance] = currentPath
				return
			end

			local previousPath = lastKnownPaths[instance]

			if pendingProperty == "Source" and instance:IsA("LuaSourceContainer") then
				local newSource = safeReadSource(instance)
				if newSource == nil or lastSentSource[instance] == newSource then
					lastKnownPaths[instance] = currentPath
					return
				end
				lastSentSource[instance] = newSource
			end

			if previousPath and currentPath ~= previousPath and callbacks.onRenamed then
				callbacks.onRenamed(instance, previousPath, currentPath)
			elseif callbacks.onChanged then
				callbacks.onChanged(instance, pendingProperty)
			end

			lastKnownPaths[instance] = currentPath
		end)
	end

	local function connectInstance(instance)
		if not Listener.isSyncAllowed() then
			return
		end

		if not Listener.shouldSyncInstance(instance, shouldSync) then
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
			scheduleChanged(instance, propertyName)
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
		lastSentSource[instance] = nil
	end

	local function onAdded(instance)
		if not Listener.shouldSyncInstance(instance, shouldSync) then
			return
		end

		lastKnownPaths[instance] = PathUtil.getInstancePath(instance)
		connectInstance(instance)
		if callbacks.onAdded then
			callbacks.onAdded(instance)
		end
	end

	local function onRemoving(instance)
		local previousPath = lastKnownPaths[instance] or PathUtil.getInstancePath(instance)
		if Listener.shouldSyncInstance(instance, shouldSync) and callbacks.onRemoving then
			callbacks.onRemoving(instance, previousPath)
		end
		unwatchInstance(instance)
	end

	for _, descendant in ipairs(game:GetDescendants()) do
		if Listener.shouldSyncInstance(descendant, shouldSync) then
			connectInstance(descendant)
		end
	end

	for _, child in ipairs(game:GetChildren()) do
		if Listener.shouldSyncInstance(child, shouldSync) then
			connectInstance(child)
		end
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
		for instance in pairs(pendingProperties) do
			pendingProperties[instance] = nil
		end
		for instance in pairs(lastKnownPaths) do
			lastKnownPaths[instance] = nil
		end
		for instance in pairs(lastSentSource) do
			lastSentSource[instance] = nil
		end
	end
end

return Listener
