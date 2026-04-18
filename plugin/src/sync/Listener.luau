local PathUtil = require(script.Parent.Parent.util.PathUtil)

local Listener = {}
local DEFAULT_DEBOUNCE_SECONDS = 0.15

function Listener.attach(shouldSync, callbacks, options)
	local connections = {}
	local changedConnections = {}
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
	end

	local function scheduleChanged(instance)
		cancelPending(instance)

		pendingThreads[instance] = task.delay(debounceSeconds, function()
			pendingThreads[instance] = nil
			if not shouldSync(instance) then
				return
			end

			local previousPath = lastKnownPaths[instance]
			local currentPath = PathUtil.getInstancePath(instance)

			if previousPath and currentPath ~= previousPath and callbacks.onRenamed then
				callbacks.onRenamed(instance, previousPath, currentPath)
			elseif callbacks.onChanged then
				callbacks.onChanged(instance)
			end

			lastKnownPaths[instance] = currentPath
		end)
	end

	local function watchInstance(instance)
		if changedConnections[instance] then
			return
		end

		lastKnownPaths[instance] = PathUtil.getInstancePath(instance)
		changedConnections[instance] = instance.Changed:Connect(function()
			scheduleChanged(instance)
		end)
	end

	local function unwatchInstance(instance)
		disconnectChanged(instance)
		lastKnownPaths[instance] = nil
	end

	local function onAdded(instance)
		lastKnownPaths[instance] = PathUtil.getInstancePath(instance)
		if shouldSync(instance) and callbacks.onAdded then
			callbacks.onAdded(instance)
		end
		watchInstance(instance)
	end

	local function onRemoving(instance)
		local previousPath = lastKnownPaths[instance] or PathUtil.getInstancePath(instance)
		if shouldSync(instance) and callbacks.onRemoving then
			callbacks.onRemoving(instance, previousPath)
		end
		unwatchInstance(instance)
	end

	for _, descendant in ipairs(game:GetDescendants()) do
		watchInstance(descendant)
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
