local HttpService = game:GetService("HttpService")

local WebSocketClient = {}
WebSocketClient.__index = WebSocketClient

local function normalizeWebSocketUrl(baseUrl)
	local trimmed = string.gsub(baseUrl or "", "/+$", "")
	if trimmed == "" then
		return "ws://127.0.0.1:34872"
	end

	trimmed = string.gsub(trimmed, "^http://", "ws://")
	trimmed = string.gsub(trimmed, "^https://", "wss://")
	trimmed = string.gsub(trimmed, "://localhost", "://127.0.0.1")
	return trimmed
end

function WebSocketClient.new(baseUrl, callbacks)
	local self = setmetatable({}, WebSocketClient)
	self.url = normalizeWebSocketUrl(baseUrl)
	self.callbacks = callbacks or {}
	self.socket = nil
	self.isOpen = false
	self.messageConnection = nil
	self.closeConnection = nil
	self.openConnection = nil
	self.errorConnection = nil
	return self
end

function WebSocketClient:setBaseUrl(baseUrl)
	self.url = normalizeWebSocketUrl(baseUrl)
end

local function disconnect(connection)
	if connection then
		connection:Disconnect()
	end
end

local function isSocketOpen(socket)
	local success, connectionState = pcall(function()
		return socket.ConnectionState
	end)

	return success and connectionState == Enum.WebStreamClientState.Open
end

local function connectionStateLabel(socket)
	local success, connectionState = pcall(function()
		return socket.ConnectionState
	end)

	if success and connectionState ~= nil then
		return tostring(connectionState)
	end

	return "unknown"
end

function WebSocketClient:connect()
	if self.socket then
		return self.isOpen, self.isOpen and nil or "WebSocket connection is already opening."
	end

	local success, socket = pcall(function()
		return HttpService:CreateWebStreamClient(Enum.WebStreamClientType.WebSocket, {
			Url = self.url,
		})
	end)

	if not success then
		return false, tostring(socket)
	end

	self.socket = socket
	self.isOpen = false

	local settleEvent = Instance.new("BindableEvent")
	local settled = false

	local function settle(result, message)
		if settled then
			return
		end

		settled = true
		settleEvent:Fire(result, message)
	end

	local function markOpen(responseStatusCode, headers)
		if self.isOpen then
			settle(true)
			return
		end

		self.isOpen = true
		if self.callbacks.onOpen then
			self.callbacks.onOpen(responseStatusCode, headers)
		end
		settle(true)
	end

	self.openConnection = socket.Opened:Connect(function(responseStatusCode, headers)
		markOpen(responseStatusCode, headers)
	end)

	self.messageConnection = socket.MessageReceived:Connect(function(message)
		if not self.isOpen and isSocketOpen(socket) then
			markOpen(nil, nil)
		end

		if self.callbacks.onMessage then
			self.callbacks.onMessage(message)
		end
	end)

	self.errorConnection = socket.Error:Connect(function(responseStatusCode, errorMessage)
		local formatted = tostring(errorMessage)
		if formatted == "" then
			formatted = "WebSocket stream error."
		end

		if self.callbacks.onError then
			self.callbacks.onError(responseStatusCode, formatted)
		end

		if not self.isOpen then
			settle(false, formatted)
		end
	end)

	self.closeConnection = socket.Closed:Connect(function()
		local wasOpen = self.isOpen
		self.isOpen = false

		if not settled then
			settle(false, "WebSocket closed before the connection opened.")
		end

		if self.callbacks.onClose then
			self.callbacks.onClose(wasOpen)
		end

		self:close()
	end)

	if isSocketOpen(socket) then
		markOpen(nil, nil)
	end

	task.delay(5, function()
		if self.isOpen or isSocketOpen(socket) then
			markOpen(nil, nil)
			return
		end

		settle(false, "Timed out waiting for the WebSocket to open (state: " .. connectionStateLabel(socket) .. ").")
	end)

	local opened, errorMessage = settleEvent.Event:Wait()
	settleEvent:Destroy()

	if not opened then
		self:close()
		return false, errorMessage
	end

	return true
end

function WebSocketClient:isConnected()
	return self.socket ~= nil and self.isOpen
end

function WebSocketClient:send(payload)
	if not self.socket or not self.isOpen then
		return false, "No WebSocket connection."
	end

	local success, result = pcall(function()
		self.socket:Send(HttpService:JSONEncode(payload))
	end)

	if not success then
		return false, tostring(result)
	end

	return true
end

function WebSocketClient:close()
	local socket = self.socket
	self.socket = nil
	self.isOpen = false

	disconnect(self.messageConnection)
	disconnect(self.closeConnection)
	disconnect(self.openConnection)
	disconnect(self.errorConnection)

	self.messageConnection = nil
	self.closeConnection = nil
	self.openConnection = nil
	self.errorConnection = nil

	if socket then
		pcall(function()
			socket:Close()
		end)
	end
end

return WebSocketClient
