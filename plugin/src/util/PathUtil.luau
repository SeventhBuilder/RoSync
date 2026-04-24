local PathUtil = {}

local function getChildren(parent)
	local success, children = pcall(function()
		return parent:GetChildren()
	end)

	if success and type(children) == "table" then
		return children
	end

	return {}
end

local function getSiblingOccurrence(instance)
	local parent = instance and instance.Parent
	if parent == nil or parent == game then
		return nil, 1
	end

	local siblings = getChildren(parent)
	local total = 0
	local ordinal = 0
	for _, sibling in ipairs(siblings) do
		if sibling.Name == instance.Name then
			total += 1
			if sibling == instance then
				ordinal = total
			end
		end
	end

	if ordinal == 0 then
		ordinal = 1
	end

	return ordinal, total
end

function PathUtil.encodePathSegment(name, ordinal, total)
	if type(name) ~= "string" or name == "" then
		name = "Instance"
	end

	if type(total) == "number" and total > 1 then
		local safeOrdinal = type(ordinal) == "number" and math.max(1, math.floor(ordinal)) or 1
		if safeOrdinal > 1 then
			return string.format("%s_%d", name, safeOrdinal)
		end
	end

	return name
end

function PathUtil.parsePathSegment(segment)
	if type(segment) ~= "string" or segment == "" then
		return "Instance", nil
	end

	local legacyMarker = ".__rosync_"
	local legacyMarkerStart = string.find(segment, legacyMarker, 1, true)
	if legacyMarkerStart ~= nil then
		local baseName = string.sub(segment, 1, legacyMarkerStart - 1)
		local ordinalText = string.sub(segment, legacyMarkerStart + string.len(legacyMarker))
		local ordinal = tonumber(ordinalText)
		if baseName ~= "" and ordinal ~= nil and ordinal >= 1 then
			return baseName, ordinal
		end
	end

	local baseName, ordinalText = string.match(segment, "^(.*)_(%d+)$")
	local ordinal = tonumber(ordinalText)
	if baseName ~= nil and baseName ~= "" and ordinal ~= nil and ordinal >= 2 then
		return baseName, ordinal
	end

	return segment, nil
end

function PathUtil.getInstanceSegment(instance)
	if instance == nil then
		return "Instance"
	end

	local ordinal, total = getSiblingOccurrence(instance)
	return PathUtil.encodePathSegment(instance.Name, ordinal, total)
end

function PathUtil.getInstancePath(instance)
	local segments = {}
	local current = instance

	while current and current ~= game do
		table.insert(segments, 1, PathUtil.getInstanceSegment(current))
		current = current.Parent
	end

	return table.concat(segments, "/")
end

return PathUtil
