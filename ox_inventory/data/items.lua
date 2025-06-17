local baseUrl = 'https://www.example.com/items.lua'

local function fetchItems()
    local response = PerformHttpRequest(baseUrl, function(err, text, headers)
        if err == 200 then
            return text
        else
            print('^1Error fetching items: ' .. tostring(err))
            return {}
        end
    end)
end

return fetchItems()