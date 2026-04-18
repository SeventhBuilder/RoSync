local PathUtil = {}

function PathUtil.getInstancePath(instance)
	local segments = {}
	local current = instance

	while current and current ~= game do
		table.insert(segments, 1, current.Name)
		current = current.Parent
	end

	return table.concat(segments, "/")
end

return PathUtil
