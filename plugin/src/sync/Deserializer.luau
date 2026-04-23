local ChangeHistoryService = game:GetService("ChangeHistoryService")
local CollectionService = game:GetService("CollectionService")

local Deserializer = {}

local READ_ONLY_INSTANCES = {
	["Workspace/Camera"] = true,
}
local LOCKED_SERVICES = {
	Workspace = true,
	Players = true,
	Lighting = true,
	ReplicatedFirst = true,
	ReplicatedStorage = true,
	ServerScriptService = true,
	ServerStorage = true,
	StarterGui = true,
	StarterPack = true,
	StarterPlayer = true,
	Teams = true,
	SoundService = true,
	TextChatService = true,
}
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

	if encodedType == "Axes" and type(encodedValue) == "table" then
		local axes = {}
		for _, axisName in ipairs(encodedValue) do
			if axisName == "X" then
				table.insert(axes, Enum.Axis.X)
			elseif axisName == "Y" then
				table.insert(axes, Enum.Axis.Y)
			elseif axisName == "Z" then
				table.insert(axes, Enum.Axis.Z)
			end
		end
		if #axes > 0 then
			return Axes.new(unpack(axes))
		end
	end

	if encodedType == "Faces" and type(encodedValue) == "table" then
		local faces = {}
		for _, faceName in ipairs(encodedValue) do
			local normalId = Enum.NormalId[faceName]
			if normalId then
				table.insert(faces, normalId)
			end
		end
		if #faces > 0 then
			return Faces.new(unpack(faces))
		end
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

local function applyAttributesAdditive(instance, attributes)
	for key, value in pairs(attributes or {}) do
		local decoded = decodeValue(value)
		pcall(function()
			instance:SetAttribute(key, decoded)
		end)
	end
end

local function applyTagsAdditive(instance, tags)
	for _, tag in ipairs(tags or {}) do
		if type(tag) == "string" then
			if not CollectionService:HasTag(instance, tag) then
				pcall(function()
					CollectionService:AddTag(instance, tag)
				end)
			end
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

local function findCandidateChild(parent, node)
	local existing = parent:FindFirstChild(node.name)
	if not existing then
		return nil
	end

	return existing
end

local function splitPath(pathValue)
	local segments = {}
	if type(pathValue) ~= "string" or pathValue == "" then
		return segments
	end

	for _, segment in ipairs(string.split(pathValue, "/")) do
		if segment ~= "" then
			table.insert(segments, segment)
		end
	end

	return segments
end

local function joinPath(parentPath, childName)
	if parentPath == nil or parentPath == "" then
		return childName
	end

	return parentPath .. "/" .. childName
end

local function isReadOnlyPath(pathValue)
	return READ_ONLY_INSTANCES[pathValue] == true
end

local function isLockedServiceName(serviceName)
	return LOCKED_SERVICES[serviceName] == true
end

local function isLockedServiceInstance(instance)
	return instance ~= nil and instance.Parent == game and isLockedServiceName(instance.Name)
end

local function countNodeInstances(node)
	local total = 1
	for _, childNode in ipairs(node.children or {}) do
		total += countNodeInstances(childNode)
	end
	return total
end

local function countTreeInstances(tree)
	local total = 0
	for _, serviceNode in ipairs(tree.services or {}) do
		total += countNodeInstances(serviceNode)
	end
	return total
end

local function createProgressState(options, total)
	if type(options) ~= "table" or type(options.onProgress) ~= "function" then
		return nil
	end

	return {
		done = 0,
		total = total,
		batchSize = type(options.batchSize) == "number" and math.max(1, options.batchSize) or 50,
		onProgress = options.onProgress,
	}
end

local function markProgress(progressState)
	if progressState == nil then
		return
	end

	progressState.done += 1
	if progressState.done % progressState.batchSize == 0 or progressState.done >= progressState.total then
		progressState.onProgress(progressState.done, progressState.total)
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

local function findInstanceByPath(pathValue)
	local segments = splitPath(pathValue)
	if #segments == 0 then
		return nil
	end

	local current = getServiceRoot(segments[1])
	if not current then
		return nil
	end

	for index = 2, #segments do
		current = current:FindFirstChild(segments[index])
		if not current then
			return nil
		end
	end

	return current
end

local function ensureParentForPath(pathValue)
	local segments = splitPath(pathValue)
	if #segments <= 1 then
		return nil, "Expected an instance path below a service."
	end

	local current = getServiceRoot(segments[1])
	if not current then
		return nil, "Missing service " .. tostring(segments[1])
	end

	for index = 2, #segments - 1 do
		local segment = segments[index]
		local child = current:FindFirstChild(segment)
		if not child then
			child = Instance.new("Folder")
			child.Name = segment
			child.Parent = current
		end
		current = child
	end

	return current
end

local applyNode

local function applyChildrenRecursive(parentInstance, parentPath, childNodes, progressState)
	for _, childNode in ipairs(childNodes or {}) do
		local childPath = joinPath(parentPath, childNode.name)
		if isReadOnlyPath(childPath) then
			markProgress(progressState)
			continue
		end

		local childInstance = findCandidateChild(parentInstance, childNode)
		if not childInstance then
			childInstance = createInstanceForNode(childNode)
			childInstance.Name = childNode.name
			childInstance.Parent = parentInstance
		end

		applyNode(childInstance, childNode, childPath, progressState)
	end
end

applyNode = function(instance, node, nodePath, progressState)
	if isReadOnlyPath(nodePath) then
		markProgress(progressState)
		return true
	end

	instance.Name = node.name

	applyAttributesAdditive(instance, node.attributes)
	applyTagsAdditive(instance, node.tags)
	local deferredPrimaryPart = applyProperties(instance, node)
	markProgress(progressState)
	applyChildrenRecursive(instance, nodePath, node.children, progressState)

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

local function applyServiceNode(serviceNode, progressState)
	local service = getServiceRoot(serviceNode.name)
	if not service then
		return false, "Missing service " .. tostring(serviceNode.name)
	end

	applyAttributesAdditive(service, serviceNode.attributes)
	applyTagsAdditive(service, serviceNode.tags)
	applyProperties(service, serviceNode)
	markProgress(progressState)
	applyChildrenRecursive(service, serviceNode.name, serviceNode.children, progressState)

	return true
end

function Deserializer.applySyncInstance(pathValue, node, options)
	if type(pathValue) ~= "string" or type(node) ~= "table" then
		return false, "Expected path and node."
	end

	if isReadOnlyPath(pathValue) then
		return true
	end

	local segments = splitPath(pathValue)
	if #segments == 0 then
		return false, "Expected a Roblox path."
	end

	ChangeHistoryService:SetWaypoint("Before RoSync Sync Instance")
	local progressState = createProgressState(options, countNodeInstances(node))

	if #segments == 1 then
		local success, result = applyServiceNode({
			name = segments[1],
			className = node.className or segments[1],
			properties = node.properties or {},
			attributes = node.attributes or {},
			tags = node.tags or {},
			source = node.source,
			children = node.children or {},
		}, progressState)
		ChangeHistoryService:SetWaypoint("After RoSync Sync Instance")
		return success, result, progressState and progressState.done or countNodeInstances(node)
	end

	local parent, parentError = ensureParentForPath(pathValue)
	if not parent then
		return false, parentError
	end

	local childNode = {
		name = segments[#segments],
		className = node.className or "Folder",
		properties = node.properties or {},
		attributes = node.attributes or {},
		tags = node.tags or {},
		source = node.source,
		children = node.children or {},
	}

	local instance = findCandidateChild(parent, childNode)
	if not instance then
		instance = createInstanceForNode(childNode)
		instance.Name = childNode.name
		instance.Parent = parent
	end

	applyNode(instance, childNode, pathValue, progressState)
	ChangeHistoryService:SetWaypoint("After RoSync Sync Instance")
	return true, nil, progressState and progressState.done or countNodeInstances(childNode)
end

function Deserializer.removeAtPath(pathValue)
	if isReadOnlyPath(pathValue) then
		return true
	end

	local instance = findInstanceByPath(pathValue)
	if not instance then
		return false, "Instance not found at " .. tostring(pathValue)
	end

	if instance == game then
		return false, "Cannot remove the DataModel root."
	end

	if isLockedServiceInstance(instance) then
		return false, "Cannot remove locked service " .. tostring(instance.Name)
	end

	ChangeHistoryService:SetWaypoint("Before RoSync Remove")
	local success, removeError = pcall(function()
		instance:Destroy()
	end)
	ChangeHistoryService:SetWaypoint("After RoSync Remove")

	if not success then
		return false, tostring(removeError)
	end

	return true
end

function Deserializer.renameAtPath(oldPath, newPath)
	if isReadOnlyPath(oldPath) or isReadOnlyPath(newPath) then
		return true
	end

	local instance = findInstanceByPath(oldPath)
	if not instance then
		return false, "Instance not found at " .. tostring(oldPath)
	end

	if isLockedServiceInstance(instance) then
		return false, "Cannot rename or move locked service " .. tostring(instance.Name)
	end

	local segments = splitPath(newPath)
	if #segments == 0 then
		return false, "Expected a destination Roblox path."
	end

	local nextParent = nil
	if #segments > 1 then
		local parent, parentError = ensureParentForPath(newPath)
		if not parent then
			return false, parentError
		end
		nextParent = parent
	end

	ChangeHistoryService:SetWaypoint("Before RoSync Rename")

	local success, renameError = pcall(function()
		if nextParent then
			instance.Parent = nextParent
		end
		instance.Name = segments[#segments]
	end)

	ChangeHistoryService:SetWaypoint("After RoSync Rename")

	if not success then
		return false, tostring(renameError)
	end

	return true
end

function Deserializer.applyTree(tree, options)
	if type(tree) ~= "table" or type(tree.services) ~= "table" then
		return false, "Expected a tree with services."
	end

	local errors = {}
	local progressState = createProgressState(options, countTreeInstances(tree))
	ChangeHistoryService:SetWaypoint("Before RoSync Apply")

	for _, serviceNode in ipairs(tree.services) do
		local success, result = applyServiceNode(serviceNode, progressState)
		if not success then
			table.insert(errors, tostring(result))
		end
	end

	ChangeHistoryService:SetWaypoint("After RoSync Apply")

	if #errors > 0 then
		return false, table.concat(errors, "\n")
	end

	return true, nil, progressState and progressState.done or countTreeInstances(tree)
end

return Deserializer
