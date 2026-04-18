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
	self.messageConnection = nil
	self.closeConnection = nil
	return self
end

function WebSocketClient:setBaseUrl(baseUrl)
	self.url = normalizeWebSocketUrl(baseUrl)
end

function WebSocketClient:connect()
	if self.socket then
		return true
	end

	local success, socket = pcall(function()
		return HttpService:WebSocketConnect(self.url)
	end)

	if not success then
		return false, tostring(socket)
	end

	self.socket = socket
	self.messageConnection = socket.MessageReceived:Connect(function(message)
		if self.callbacks.onMessage then
			self.callbacks.onMessage(message)
		end
	end)
	self.closeConnection = socket.Close:Connect(function()
		if self.callbacks.onClose then
			self.callbacks.onClose()
		end
		self:close()
	end)

	return true
end

function WebSocketClient:isConnected()
	return self.socket ~= nil
end

function WebSocketClient:send(payload)
	if not self.socket then
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
	if self.messageConnection then
		self.messageConnection:Disconnect()
		self.messageConnection = nil
	end

	if self.closeConnection then
		self.closeConnection:Disconnect()
		self.closeConnection = nil
	end

	if self.socket then
		pcall(function()
			self.socket:Close()
		end)
		self.socket = nil
	end
end

return WebSocketClient
