local ReflectionService = game:GetService("ReflectionService")

local SchemaUtil = {}
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

function SchemaUtil.getSyncableProperties(className)
	if propertyCache[className] ~= nil then
		return propertyCache[className]
	end

	local properties = {}
	local success, reflectedProperties = pcall(function()
		return ReflectionService:GetPropertiesOfClass(className, {
			ExcludeInherited = false,
			ExcludeDisplay = false,
		})
	end)

	if success and type(reflectedProperties) == "table" then
		for _, property in ipairs(reflectedProperties) do
			local propertyName = property.Name
			local permits = property.Permits
			local canRead = permits == nil or permits.Read ~= nil or permits.ReadParallel ~= nil
			local canWrite = permits == nil or permits.Write ~= nil or permits.WriteParallel ~= nil

			if type(propertyName) == "string" and property.Serialized ~= false and canRead and canWrite and not PROPERTY_DENYLIST[propertyName] then
				table.insert(properties, propertyName)
			end
		end
	end

	table.sort(properties)
	propertyCache[className] = properties
	return properties
end

return SchemaUtil
