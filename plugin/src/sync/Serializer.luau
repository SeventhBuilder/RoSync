local CollectionService = game:GetService("CollectionService")

local SchemaUtil = require(script.Parent.Parent.util.SchemaUtil)

local Serializer = {}

local SCRIPT_CLASS_NAMES = {
	Script = true,
	LocalScript = true,
	ModuleScript = true,
}

local function encodeValue(value)
	local valueType = typeof(value)

	if valueType == "number" or valueType == "string" or valueType == "boolean" then
		return value
	end

	if valueType == "Content" then
		return {
			type = "Content",
			value = tostring(value),
		}
	end

	if valueType == "BinaryString" then
		return {
			type = "BinaryString",
			value = tostring(value),
		}
	end

	if valueType == "Instance" then
		return nil
	end

	if valueType == "Vector3" then
		return {
			type = "Vector3",
			value = { value.X, value.Y, value.Z },
		}
	end

	if valueType == "Vector2" then
		return {
			type = "Vector2",
			value = { value.X, value.Y },
		}
	end

	if valueType == "Color3" then
		return {
			type = "Color3",
			value = { value.R, value.G, value.B },
		}
	end

	if valueType == "NumberRange" then
		return {
			type = "NumberRange",
			value = { value.Min, value.Max },
		}
	end

	if valueType == "Rect" then
		return {
			type = "Rect",
			value = { value.Min.X, value.Min.Y, value.Max.X, value.Max.Y },
		}
	end

	if valueType == "Ray" then
		return {
			type = "Ray",
			value = {
				{ value.Origin.X, value.Origin.Y, value.Origin.Z },
				{ value.Direction.X, value.Direction.Y, value.Direction.Z },
			},
		}
	end

	if valueType == "PhysicalProperties" then
		return {
			type = "PhysicalProperties",
			value = {
				value.Density,
				value.Friction,
				value.Elasticity,
				value.FrictionWeight,
				value.ElasticityWeight,
			},
		}
	end

	if valueType == "Axes" then
		local axes = {}
		if value.X then
			table.insert(axes, "X")
		end
		if value.Y then
			table.insert(axes, "Y")
		end
		if value.Z then
			table.insert(axes, "Z")
		end
		return {
			type = "Axes",
			value = axes,
		}
	end

	if valueType == "Faces" then
		local faces = {}
		if value.Top then
			table.insert(faces, "Top")
		end
		if value.Bottom then
			table.insert(faces, "Bottom")
		end
		if value.Left then
			table.insert(faces, "Left")
		end
		if value.Right then
			table.insert(faces, "Right")
		end
		if value.Back then
			table.insert(faces, "Back")
		end
		if value.Front then
			table.insert(faces, "Front")
		end
		return {
			type = "Faces",
			value = faces,
		}
	end

	if valueType == "NumberSequence" then
		local keypoints = {}
		for _, keypoint in ipairs(value.Keypoints) do
			table.insert(keypoints, { keypoint.Time, keypoint.Value, keypoint.Envelope })
		end
		return {
			type = "NumberSequence",
			value = keypoints,
		}
	end

	if valueType == "ColorSequence" then
		local keypoints = {}
		for _, keypoint in ipairs(value.Keypoints) do
			table.insert(keypoints, {
				keypoint.Time,
				{ keypoint.Value.R, keypoint.Value.G, keypoint.Value.B },
			})
		end
		return {
			type = "ColorSequence",
			value = keypoints,
		}
	end

	if valueType == "Font" then
		return {
			type = "Font",
			value = {
				Family = value.Family,
				Weight = tostring(value.Weight),
				Style = tostring(value.Style),
			},
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

	if valueType == "CFrame" then
		return {
			type = "CFrame",
			value = { value:GetComponents() },
		}
	end

	if valueType == "BrickColor" then
		return {
			type = "BrickColor",
			value = value.Number,
		}
	end

	if valueType == "EnumItem" then
		return {
			type = "EnumItem",
			value = tostring(value),
		}
	end

	return {
		type = valueType,
		value = tostring(value),
	}
end

local function encodePropertyValue(instance, propertyName, propertyValue)
	if propertyName == "PrimaryPart" then
		if propertyValue then
			return {
				type = "InstanceRef",
				value = {
					name = propertyValue.Name,
				},
			}
		end
		return nil
	end

	return encodeValue(propertyValue)
end

local function safeScriptSource(instance)
	if not SCRIPT_CLASS_NAMES[instance.ClassName] then
		return nil
	end

	local success, source = pcall(function()
		return instance.Source
	end)

	if success and type(source) == "string" then
		return source
	end

	return nil
end

function Serializer.serializeInstance(instance, deep)
	local serialized = {
		name = instance.Name,
		className = instance.ClassName,
		properties = {},
		attributes = instance:GetAttributes(),
		tags = CollectionService:GetTags(instance),
		children = {},
	}

	for _, propertyName in ipairs(SchemaUtil.getSyncableProperties(instance.ClassName)) do
		local success, propertyValue = pcall(function()
			return instance[propertyName]
		end)
		if success then
			local encoded = encodePropertyValue(instance, propertyName, propertyValue)
			if encoded ~= nil then
				serialized.properties[propertyName] = encoded
			end
		end
	end

	local source = safeScriptSource(instance)
	if source ~= nil then
		serialized.source = source
	end

	if deep then
		for _, child in ipairs(instance:GetChildren()) do
			table.insert(serialized.children, Serializer.serializeInstance(child, true))
		end
	end

	return serialized
end

return Serializer
