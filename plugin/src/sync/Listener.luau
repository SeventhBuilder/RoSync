local Listener = {}

function Listener.attach(shouldSync, callbacks)
	local connections = {}
	local changedConnections = {}

	local function disconnectChanged(instance)
		local existing = changedConnections[instance]
		if existing then
			existing:Disconnect()
			changedConnections[instance] = nil
		end
	end

	local function watchInstance(instance)
		if changedConnections[instance] then
			return
		end

		changedConnections[instance] = instance.Changed:Connect(function()
			if shouldSync(instance) and callbacks.onChanged then
				callbacks.onChanged(instance)
			end
		end)
	end

	local function unwatchInstance(instance)
		disconnectChanged(instance)
	end

	local function onAdded(instance)
		if shouldSync(instance) and callbacks.onAdded then
			callbacks.onAdded(instance)
		end
		watchInstance(instance)
	end

	local function onRemoving(instance)
		if shouldSync(instance) and callbacks.onRemoving then
			callbacks.onRemoving(instance)
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
	end
end

return Listener
