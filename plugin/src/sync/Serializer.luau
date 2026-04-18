local CollectionService = game:GetService("CollectionService")
local ReflectionService = game:GetService("ReflectionService")

local Serializer = {}

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

local propertyCache = {}

local function safeTostring(value)
	local success, result = pcall(function()
		return tostring(value)
	end)

	if success then
		return result
	end

	return "<unprintable>"
end

local function safeReadProperty(instance, propertyName)
	local success, value = pcall(function()
		return instance[propertyName]
	end)

	if success then
		return true, value
	end

	return false, nil
end

local function safeReadStringProperty(instance, propertyName, fallback)
	local success, value = safeReadProperty(instance, propertyName)
	if success and type(value) == "string" and value ~= "" then
		return value
	end

	return fallback
end

local function readMemberKind(rawMemberKind)
	if type(rawMemberKind) == "string" then
		return rawMemberKind
	end

	if type(rawMemberKind) == "table" then
		if type(rawMemberKind.Name) == "string" then
			return rawMemberKind.Name
		end

		if type(rawMemberKind.name) == "string" then
			return rawMemberKind.name
		end
	end

	return nil
end

local function canSyncPropertyDescriptor(propertyDescriptor)
	local permits = propertyDescriptor.Permits or propertyDescriptor.permits

	if type(permits) ~= "table" then
		return true
	end

	local canRead = permits.Read ~= nil or permits.ReadParallel ~= nil
	local canWrite = permits.Write ~= nil or permits.WriteParallel ~= nil

	return canRead and canWrite
end

local function isPropertyDescriptor(candidate)
	if type(candidate) ~= "table" then
		return false
	end

	local propertyName = candidate.Name or candidate.name
	if type(propertyName) ~= "string" or PROPERTY_DENYLIST[propertyName] then
		return false
	end

	local memberKind = readMemberKind(candidate.MemberType or candidate.memberType or candidate.Kind or candidate.kind)
	if memberKind ~= nil and memberKind ~= "Property" then
		return false
	end

	if memberKind == nil then
		local looksLikePropertyDescriptor = candidate.Type ~= nil
			or candidate.type ~= nil
			or candidate.ValueType ~= nil
			or candidate.valueType ~= nil

		if not looksLikePropertyDescriptor then
			return false
		end
	end

	if candidate.Serialized == false or candidate.serialized == false then
		return false
	end

	return canSyncPropertyDescriptor(candidate)
end

local function collectPropertyNames(node, propertyNames, visited)
	if type(node) ~= "table" or visited[node] then
		return
	end

	visited[node] = true

	if isPropertyDescriptor(node) then
		propertyNames[node.Name or node.name] = true
	end

	for _, nested in pairs(node) do
		if type(nested) == "table" then
			collectPropertyNames(nested, propertyNames, visited)
		end
	end
end

local function getPropertyNamesForClass(className)
	if propertyCache[className] ~= nil then
		return propertyCache[className]
	end

	local propertyNames = {}
	local success, classDescriptor = pcall(function()
		return ReflectionService:GetClassDescriptor(className)
	end)

	if success and type(classDescriptor) == "table" then
		collectPropertyNames(classDescriptor, propertyNames, {})
	end

	local properties = {}
	for propertyName in pairs(propertyNames) do
		table.insert(properties, propertyName)
	end

	table.sort(properties)
	propertyCache[className] = properties
	return properties
end

local function encodeNumber(value)
	local valueType = "float"
	if value == value and value ~= math.huge and value ~= -math.huge and math.floor(value) == value then
		valueType = "int"
	end

	return {
		type = valueType,
		value = value,
	}
end

local function encodeValue(value)
	if value == nil then
		return nil
	end

	local valueType = typeof(value)

	if valueType == "boolean" then
		return {
			type = "bool",
			value = value,
		}
	end

	if valueType == "number" then
		return encodeNumber(value)
	end

	if valueType == "string" then
		return {
			type = "string",
			value = value,
		}
	end

	if valueType == "Vector3" then
		return {
			type = "Vector3",
			value = { value.X, value.Y, value.Z },
		}
	end

	if valueType == "CFrame" then
		return {
			type = "CFrame",
			value = { value:GetComponents() },
		}
	end

	if valueType == "Color3" then
		return {
			type = "Color3",
			value = { value.R, value.G, value.B },
		}
	end

	if valueType == "BrickColor" then
		return {
			type = "BrickColor",
			value = value.Number,
		}
	end

	if valueType == "UDim2" then
		return {
			type = "UDim2",
			value = {
				value.X.Scale,
				value.X.Offset,
				value.Y.Scale,
				value.Y.Offset,
			},
		}
	end

	if valueType == "UDim" then
		return {
			type = "UDim",
			value = { value.Scale, value.Offset },
		}
	end

	if valueType == "NumberRange" then
		return {
			type = "NumberRange",
			value = { value.Min, value.Max },
		}
	end

	if valueType == "EnumItem" then
		return {
			type = "EnumItem",
			value = tostring(value),
		}
	end

	return {
		type = "unknown",
		raw = safeTostring(value),
	}
end

local function encodeAttributes(instance)
	local success, attributes = pcall(function()
		return instance:GetAttributes()
	end)

	if not success or type(attributes) ~= "table" then
		return {}
	end

	local encodedAttributes = {}
	for attributeName, attributeValue in pairs(attributes) do
		encodedAttributes[attributeName] = encodeValue(attributeValue)
	end

	return encodedAttributes
end

local function safeScriptSource(instance, className)
	if not SCRIPT_CLASS_NAMES[className] then
		return nil
	end

	local success, source = safeReadProperty(instance, "Source")
	if success and type(source) == "string" then
		return source
	end

	return nil
end

local function safeGetTags(instance)
	local success, tags = pcall(function()
		return CollectionService:GetTags(instance)
	end)

	if success and type(tags) == "table" then
		return tags
	end

	return {}
end

local function safeGetChildren(instance)
	local success, children = pcall(function()
		return instance:GetChildren()
	end)

	if success and type(children) == "table" then
		return children
	end

	return {}
end

function Serializer.serializeInstance(instance, deep)
	local className = safeReadStringProperty(instance, "ClassName", "Instance")
	local name = safeReadStringProperty(instance, "Name", className)

	local serialized = {
		name = name,
		className = className,
		properties = {},
		attributes = encodeAttributes(instance),
		tags = safeGetTags(instance),
		children = {},
	}

	for _, propertyName in ipairs(getPropertyNamesForClass(className)) do
		local success, propertyValue = safeReadProperty(instance, propertyName)
		if success then
			local encodedValue = encodeValue(propertyValue)
			if encodedValue ~= nil then
				serialized.properties[propertyName] = encodedValue
			end
		end
	end

	local source = safeScriptSource(instance, className)
	if source ~= nil then
		serialized.source = source
	end

	if deep then
		for _, child in ipairs(safeGetChildren(instance)) do
			table.insert(serialized.children, Serializer.serializeInstance(child, true))
		end
	end

	return serialized
end

return Serializer
