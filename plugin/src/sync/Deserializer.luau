local ChangeHistoryService = game:GetService("ChangeHistoryService")
local CollectionService = game:GetService("CollectionService")

local Deserializer = {}

local MANAGED_ATTRIBUTE = "_RoSyncManaged"
local SCRIPT_CLASS_NAMES = {
	Script = true,
	LocalScript = true,
	ModuleScript = true,
}

local PROPERTY_DENYLIST = {
	Parent = true,
	Name = true,
	ClassName = true,
	Source = true,
	LinkedSource = true,
	ScriptGuid = true,
	Tags = true,
	Attributes = true,
	AttributesReplicate = true,
	AttributesSerialize = true,
	DataCost = true,
	UniqueId = true,
	HistoryId = true,
	Capabilities = true,
	DefinesCapabilities = true,
	numExpectedDirectChildren = true,
	Children = true,
}

local function readEncodedType(rawValue)
	if type(rawValue) ~= "table" then
		return nil
	end

	return rawValue.type or rawValue.Type
end

local function readEncodedValue(rawValue)
	if type(rawValue) ~= "table" then
		return rawValue
	end

	if rawValue.value ~= nil then
		return rawValue.value
	end

	return rawValue.Value
end

local function decodeEnumItem(enumText)
	if type(enumText) ~= "string" or enumText == "" then
		return nil
	end

	local segments = string.split(enumText, ".")
	if #segments >= 3 and segments[1] == "Enum" then
		local enumType = Enum[segments[2]]
		if enumType then
			return enumType[segments[3]]
		end
	elseif #segments >= 2 then
		local enumType = Enum[segments[1]]
		if enumType then
			return enumType[segments[2]]
		end
	end

	return nil
end

local function decodeValue(rawValue)
	if typeof(rawValue) ~= "table" then
		return rawValue
	end

	local encodedType = readEncodedType(rawValue)
	local encodedValue = readEncodedValue(rawValue)

	if type(encodedType) ~= "string" then
		return rawValue
	end

	if encodedType == "Vector2" and type(encodedValue) == "table" and #encodedValue >= 2 then
		return Vector2.new(encodedValue[1], encodedValue[2])
	end

	if encodedType == "Vector3" and type(encodedValue) == "table" and #encodedValue >= 3 then
		return Vector3.new(encodedValue[1], encodedValue[2], encodedValue[3])
	end

	if encodedType == "Color3" and type(encodedValue) == "table" and #encodedValue >= 3 then
		return Color3.new(encodedValue[1], encodedValue[2], encodedValue[3])
	end

	if encodedType == "UDim2" and type(encodedValue) == "table" and #encodedValue >= 4 then
		return UDim2.new(encodedValue[1], encodedValue[2], encodedValue[3], encodedValue[4])
	end

	if encodedType == "UDim" and type(encodedValue) == "table" and #encodedValue >= 2 then
		return UDim.new(encodedValue[1], encodedValue[2])
	end

	if encodedType == "CFrame" and type(encodedValue) == "table" then
		return CFrame.new(unpack(encodedValue))
	end

	if encodedType == "BrickColor" and type(encodedValue) == "string" then
		local success, result = pcall(function()
			return BrickColor.new(encodedValue)
		end)
		if success then
			return result
		end
	end

	if encodedType == "BrickColor" and type(encodedValue) == "number" then
		local success, result = pcall(function()
			return BrickColor.new(encodedValue)
		end)
		if success then
			return result
		end
	end

	if encodedType == "EnumItem" then
		return decodeEnumItem(encodedValue)
	end

	if encodedType == "Enum" then
		return decodeEnumItem(encodedValue)
	end

	if encodedType == "bool" or encodedType == "boolean" then
		return encodedValue == true
	end

	if encodedType == "int" or encodedType == "float" or encodedType == "number" then
		return tonumber(encodedValue)
	end

	if encodedType == "string" then
		return tostring(encodedValue)
	end

	if encodedType == "NumberRange" and type(encodedValue) == "table" and #encodedValue >= 2 then
		return NumberRange.new(encodedValue[1], encodedValue[2])
	end

	if encodedType == "Rect" and type(encodedValue) == "table" and #encodedValue >= 4 then
		return Rect.new(
			Vector2.new(encodedValue[1], encodedValue[2]),
			Vector2.new(encodedValue[3], encodedValue[4])
		)
	end

	if encodedType == "Ray" and type(encodedValue) == "table" and #encodedValue >= 2 then
		local origin = decodeValue({
			type = "Vector3",
			value = encodedValue[1],
		})
		local direction = decodeValue({
			type = "Vector3",
			value = encodedValue[2],
		})
		if origin and direction then
			return Ray.new(origin, direction)
		end
	end

	if encodedType == "PhysicalProperties" and type(encodedValue) == "table" and #encodedValue >= 5 then
		return PhysicalProperties.new(
			encodedValue[1],
			encodedValue[2],
			encodedValue[3],
			encodedValue[4],
			encodedValue[5]
		)
	end

	if encodedType == "NumberSequence" and type(encodedValue) == "table" then
		local keypoints = {}
		for _, keypoint in ipairs(encodedValue) do
			if type(keypoint) == "table" and #keypoint >= 3 then
				table.insert(keypoints, NumberSequenceKeypoint.new(keypoint[1], keypoint[2], keypoint[3]))
			end
		end
		if #keypoints > 0 then
			return NumberSequence.new(keypoints)
		end
	end

	if encodedType == "ColorSequence" and type(encodedValue) == "table" then
		local keypoints = {}
		for _, keypoint in ipairs(encodedValue) do
			if type(keypoint) == "table" and #keypoint >= 2 then
				local color = decodeValue({
					type = "Color3",
					value = keypoint[2],
				})
				if color then
					table.insert(keypoints, ColorSequenceKeypoint.new(keypoint[1], color))
				end
			end
		end
		if #keypoints > 0 then
			return ColorSequence.new(keypoints)
		end
	end

	if encodedType == "Font" and type(encodedValue) == "table" then
		local family = encodedValue.Family or encodedValue.family
		if type(family) == "string" and family ~= "" then
			local weight = decodeEnumItem(encodedValue.Weight or encodedValue.weight) or Enum.FontWeight.Regular
			local style = decodeEnumItem(encodedValue.Style or encodedValue.style) or Enum.FontStyle.Normal
			local success, result = pcall(function()
				return Font.new(family, weight, style)
			end)
			if success then
				return result
			end
		end
	end

	return encodedValue
end

local function applyAttributesExact(instance, attributes)
	local desired = {}
	for key, value in pairs(attributes or {}) do
		desired[key] = true
		local decoded = decodeValue(value)
		pcall(function()
			instance:SetAttribute(key, decoded)
		end)
	end

	for key in pairs(instance:GetAttributes()) do
		if key ~= MANAGED_ATTRIBUTE and not desired[key] then
			pcall(function()
				instance:SetAttribute(key, nil)
			end)
		end
	end
end

local function applyTagsExact(instance, tags)
	local desired = {}
	for _, tag in ipairs(tags or {}) do
		if type(tag) == "string" then
			desired[tag] = true
			if not CollectionService:HasTag(instance, tag) then
				pcall(function()
					CollectionService:AddTag(instance, tag)
				end)
			end
		end
	end

	for _, tag in ipairs(CollectionService:GetTags(instance)) do
		if not desired[tag] then
			pcall(function()
				CollectionService:RemoveTag(instance, tag)
			end)
		end
	end
end

local function createInstanceForNode(node)
	local success, created = pcall(function()
		return Instance.new(node.className)
	end)

	if success then
		return created
	end

	local fallback = Instance.new("Folder")
	fallback.Name = node.name or node.className or "Instance"
	return fallback
end

local function applyProperties(instance, node)
	local deferredPrimaryPart = nil

	for propertyName, rawValue in pairs(node.properties or {}) do
		if propertyName == "PrimaryPart" then
			deferredPrimaryPart = rawValue
		elseif not PROPERTY_DENYLIST[propertyName] then
			local decodedValue = decodeValue(rawValue)
			if decodedValue ~= nil then
				pcall(function()
					instance[propertyName] = decodedValue
				end)
			end
		end
	end

	if SCRIPT_CLASS_NAMES[instance.ClassName] and type(node.source) == "string" then
		pcall(function()
			instance.Source = node.source
		end)
	end

	return deferredPrimaryPart
end

local function isManaged(instance)
	local value = instance:GetAttribute(MANAGED_ATTRIBUTE)
	return value == true
end

local function findCandidateChild(parent, node)
	local existing = parent:FindFirstChild(node.name)
	if not existing then
		return nil
	end

	if existing.ClassName == node.className then
		return existing
	end

	pcall(function()
		existing:Destroy()
	end)
	return nil
end

local function applyNode(instance, node)
	instance.Name = node.name
	pcall(function()
		instance:SetAttribute(MANAGED_ATTRIBUTE, true)
	end)

	applyAttributesExact(instance, node.attributes)
	applyTagsExact(instance, node.tags)
	local deferredPrimaryPart = applyProperties(instance, node)

	local matchedChildren = {}
	for _, childNode in ipairs(node.children or {}) do
		local childInstance = findCandidateChild(instance, childNode)
		if not childInstance then
			childInstance = createInstanceForNode(childNode)
			childInstance.Name = childNode.name
			childInstance.Parent = instance
		end

		matchedChildren[childInstance] = true
		applyNode(childInstance, childNode)
	end

	for _, child in ipairs(instance:GetChildren()) do
		if not matchedChildren[child] and isManaged(child) then
			pcall(function()
				child:Destroy()
			end)
		end
	end

	if type(deferredPrimaryPart) == "table" then
		local referenceValue = deferredPrimaryPart.value or deferredPrimaryPart.Value or deferredPrimaryPart
		local targetName = type(referenceValue) == "table" and referenceValue.name or nil
		if type(targetName) == "string" and targetName ~= "" then
			local target = instance:FindFirstChild(targetName, true)
			if target then
				pcall(function()
					instance.PrimaryPart = target
				end)
			end
		end
	end
end

local function getServiceRoot(serviceName)
	local success, service = pcall(function()
		return game:GetService(serviceName)
	end)

	if success then
		return service
	end

	return game:FindFirstChild(serviceName)
end

local function applyServiceNode(serviceNode)
	local service = getServiceRoot(serviceNode.name)
	if not service then
		return false, "Missing service " .. tostring(serviceNode.name)
	end

	local matchedChildren = {}
	for _, childNode in ipairs(serviceNode.children or {}) do
		local childInstance = findCandidateChild(service, childNode)
		if not childInstance then
			childInstance = createInstanceForNode(childNode)
			childInstance.Name = childNode.name
			childInstance.Parent = service
		end

		matchedChildren[childInstance] = true
		applyNode(childInstance, childNode)
	end

	for _, child in ipairs(service:GetChildren()) do
		if not matchedChildren[child] and isManaged(child) then
			pcall(function()
				child:Destroy()
			end)
		end
	end

	return true
end

function Deserializer.applyTree(tree)
	if type(tree) ~= "table" or type(tree.services) ~= "table" then
		return false, "Expected a tree with services."
	end

	local errors = {}
	ChangeHistoryService:SetWaypoint("Before RoSync Apply")

	for _, serviceNode in ipairs(tree.services) do
		local success, result = applyServiceNode(serviceNode)
		if not success then
			table.insert(errors, tostring(result))
		end
	end

	ChangeHistoryService:SetWaypoint("After RoSync Apply")

	if #errors > 0 then
		return false, table.concat(errors, "\n")
	end

	return true
end

return Deserializer
