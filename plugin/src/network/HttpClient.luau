local HttpService = game:GetService("HttpService")

local HttpClient = {}
HttpClient.__index = HttpClient

local function normalizeBaseUrl(baseUrl)
	local trimmed = string.gsub(baseUrl or "", "/+$", "")
	if trimmed == "" then
		return "http://127.0.0.1:34872"
	end
	trimmed = string.gsub(trimmed, "://localhost", "://127.0.0.1")
	return trimmed
end

function HttpClient.new(baseUrl)
	local self = setmetatable({}, HttpClient)
	self.baseUrl = normalizeBaseUrl(baseUrl)
	return self
end

function HttpClient:setBaseUrl(baseUrl)
	self.baseUrl = normalizeBaseUrl(baseUrl)
end

function HttpClient:request(method, route, payload)
	local request = {
		Url = self.baseUrl .. route,
		Method = method,
		Headers = {
			["Content-Type"] = "application/json",
		},
	}

	if payload ~= nil then
		request.Body = HttpService:JSONEncode(payload)
	end

	local success, response = pcall(function()
		return HttpService:RequestAsync(request)
	end)

	if not success then
		return false, tostring(response)
	end

	if not response.Success then
		return false, response.Body
	end

	local decoded = nil
	if response.Body and response.Body ~= "" then
		local decodeSuccess, decodeResult = pcall(function()
			return HttpService:JSONDecode(response.Body)
		end)
		if decodeSuccess then
			decoded = decodeResult
		end
	end

	return true, decoded or {}
end

function HttpClient:getHealth()
	return self:request("GET", "/health")
end

function HttpClient:getTree()
	return self:request("GET", "/api/tree")
end

return HttpClient
