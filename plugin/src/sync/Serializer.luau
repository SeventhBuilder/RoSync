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

-- ── Helpers ──────────────────────────────────────────────────────────────────

local function safeTostring(value)
	local success, result = pcall(tostring, value)
	return success and result or "<unprintable>"
end

local function safeReadProperty(instance, propertyName)
	local success, value = pcall(function()
		return instance[propertyName]
	end)
	return success, success and value or nil
end

local function safeReadStringProperty(instance, propertyName, fallback)
	local success, value = safeReadProperty(instance, propertyName)
	if success and type(value) == "string" and value ~= "" then
		return value
	end
	return fallback
end

-- ── Property name discovery via ReflectionService ────────────────────────────
-- Uses GetPropertiesOfClass — the correct ReflectionService API.
-- Returns a flat array of property descriptor tables, each with:
--   .Name    (string)
--   .Permits (table, optional) — has .Read/.Write fields if restricted

local function getPropertyNamesForClass(className)
	if propertyCache[className] ~= nil then
		return propertyCache[className]
	end

	local ok, props = pcall(function()
		return ReflectionService:GetPropertiesOfClass(className)
	end)

	if not ok or type(props) ~= "table" then
		propertyCache[className] = {}
		return {}
	end

	local names = {}
	for _, prop in ipairs(props) do
		local name = prop.Name
		if type(name) == "string" and not PROPERTY_DENYLIST[name] then
			-- Only include properties we can actually write back
			local permits = prop.Permits
			local canWrite = permits == nil
				or permits.Write ~= nil
				or permits.WriteParallel ~= nil
			if canWrite then
				table.insert(names, name)
			end
		end
	end

	table.sort(names)
	propertyCache[className] = names
	return names
end

-- ── Value encoder ─────────────────────────────────────────────────────────────

local function encodeNumber(value)
	local valueType = "float"
	if value == value
		and value ~= math.huge
		and value ~= -math.huge
		and math.floor(value) == value
	then
		valueType = "int"
	end
	return { type = valueType, value = value }
end

local function encodeValue(value)
	if value == nil then return nil end

	local valueType = typeof(value)

	if valueType == "boolean" then
		return { type = "bool", value = value }
	end

	if valueType == "number" then
		return encodeNumber(value)
	end

	if valueType == "string" then
		return { type = "string", value = value }
	end

	if valueType == "Vector3" then
		return { type = "Vector3", value = { value.X, value.Y, value.Z } }
	end

	if valueType == "CFrame" then
		return { type = "CFrame", value = { value:GetComponents() } }
	end

	if valueType == "Color3" then
		return { type = "Color3", value = { value.R, value.G, value.B } }
	end

	if valueType == "BrickColor" then
		return { type = "BrickColor", value = value.Number }
	end

	if valueType == "UDim2" then
		return {
			type = "UDim2",
			value = { value.X.Scale, value.X.Offset, value.Y.Scale, value.Y.Offset },
		}
	end

	if valueType == "UDim" then
		return { type = "UDim", value = { value.Scale, value.Offset } }
	end

	if valueType == "NumberRange" then
		return { type = "NumberRange", value = { value.Min, value.Max } }
	end

	if valueType == "EnumItem" then
		return { type = "EnumItem", value = tostring(value) }
	end

	if valueType == "Vector2" then
		return { type = "Vector2", value = { value.X, value.Y } }
	end

	if valueType == "Rect" then
		return {
			type = "Rect",
			value = { value.Min.X, value.Min.Y, value.Max.X, value.Max.Y },
		}
	end

	if valueType == "ColorSequence" then
		local keypoints = {}
		for _, kp in ipairs(value.Keypoints) do
			table.insert(keypoints, { time = kp.Time, color = { kp.Value.R, kp.Value.G, kp.Value.B } })
		end
		return { type = "ColorSequence", value = keypoints }
	end

	if valueType == "NumberSequence" then
		local keypoints = {}
		for _, kp in ipairs(value.Keypoints) do
			table.insert(keypoints, { time = kp.Time, value = kp.Value, envelope = kp.Envelope })
		end
		return { type = "NumberSequence", value = keypoints }
	end

	return { type = "unknown", raw = safeTostring(value) }
end

-- ── Attribute encoder ─────────────────────────────────────────────────────────

local function encodeAttributes(instance)
	local success, attributes = pcall(function()
		return instance:GetAttributes()
	end)
	if not success or type(attributes) ~= "table" then return {} end

	local encoded = {}
	for attrName, attrValue in pairs(attributes) do
		encoded[attrName] = encodeValue(attrValue)
	end
	return encoded
end

-- ── Script source ─────────────────────────────────────────────────────────────

local function safeScriptSource(instance, className)
	if not SCRIPT_CLASS_NAMES[className] then return nil end
	local success, source = safeReadProperty(instance, "Source")
	if success and type(source) == "string" then return source end
	return nil
end

-- ── Collection helpers ────────────────────────────────────────────────────────

local function safeGetTags(instance)
	local success, tags = pcall(function()
		return CollectionService:GetTags(instance)
	end)
	return (success and type(tags) == "table") and tags or {}
end

local function safeGetChildren(instance)
	local success, children = pcall(function()
		return instance:GetChildren()
	end)
	return (success and type(children) == "table") and children or {}
end

-- ── Public API ────────────────────────────────────────────────────────────────

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
