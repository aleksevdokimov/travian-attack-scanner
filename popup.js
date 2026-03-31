document.addEventListener('DOMContentLoaded', function() {
    const scanBtn = document.getElementById('scanBtn');
    const rallyScanBtn = document.getElementById('rallyScanBtn');
    const statusMessage = document.getElementById('statusMessage');
    const statusIndicator = document.getElementById('statusIndicator');
    const autoScanToggle = document.getElementById('autoScanToggle');
    
    const API_URL = 'http://127.0.0.1:8000';
    const AUTH_API_URL = `${API_URL}/api/auth/key`;
    const ATTACKS_API_URL = `${API_URL}/api/attacks`;
    const RALLY_API_URL = `${API_URL}/api/rally-point`;
    
    let isScanning = false;
    let isRallyScanning = false;
    let currentServer = '';
    let currentPlayerName = '';
    let authKey = '';
    let isAuthorized = false;
    let currentTabId = null;
    
    // Состояния индикатора
    const STATUS = {
        GREEN: 'green',     // Ключ есть, сервер доступен
        YELLOW: 'yellow',   // Ожидание ответа или проблемы с отправкой
        RED: 'red',         // Доступ запрещен
        GRAY: 'gray'        // Не инициализирован
    };
    
    // Установить состояние индикатора
    function setStatus(status, message = '') {
        statusIndicator.className = 'status-indicator';
        
        switch(status) {
            case STATUS.GREEN:
                statusIndicator.classList.add('status-green');
                break;
            case STATUS.YELLOW:
                statusIndicator.classList.add('status-yellow');
                break;
            case STATUS.RED:
                statusIndicator.classList.add('status-red');
                break;
            default:
                statusIndicator.classList.add('status-gray');
        }
        
        if (message) {
            showStatus(message, 
                status === STATUS.GREEN ? 'success' :
                status === STATUS.RED ? 'error' :
                status === STATUS.YELLOW ? 'warning' : 'info'
            );
        }
    }
    
    // Показать статусное сообщение
    function showStatus(message, type = 'info') {
        statusMessage.textContent = message;
        statusMessage.className = `status-message status-${type}`;
    }
    
    // Получить активную вкладку
    async function getActiveTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab;
    }
    
    // Получить JWT токен через background script
    async function getJwtToken() {
        try {
            console.log('[Popup] Getting JWT token...');
            const tab = await getActiveTab();
            console.log('[Popup] Tab URL:', tab.url);
            
            const response = await chrome.runtime.sendMessage({
                type: 'GET_JWT_TOKEN'
            });
            
            console.log('[Popup] JWT response:', response);
            
            if (response.token) {
                console.log('[Popup] JWT token received, length:', response.token.length);
            } else {
                console.error('[Popup] No JWT token in response');
            }
            
            return response.token;
        } catch (error) {
            console.error('[Popup] Error getting JWT:', error);
            return null;
        }
    }
    
    // Получить информацию о сервере и игроке со страницы
    async function getServerAndPlayerInfo() {
        try {
            const tab = await getActiveTab();
            
            if (!tab.url.includes('travian.com')) {
                return { server: '', playerName: '', isValid: false };
            }
            
            const result = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    // Получаем домен сервера
                    const server = window.location.hostname;
                    
					let playerName = '';
					
                    // Получаем имя игрока
                    const villageBoxes = document.getElementById('villageBoxes');
					if (villageBoxes) {
						// Ищем элемент с классом playerName внутри villageBoxes
						const playerNameElement = villageBoxes.querySelector('.playerName');
						if (playerNameElement) {
							playerName = playerNameElement.textContent.trim();
						}
					}
                    console.log('[Travian Scanner] PlayerName = ',playerName); 
                    return { server, playerName, isValid: !!playerName };
                }
            });
            
            return result[0]?.result || { server: '', playerName: '', isValid: false };
            
        } catch (error) {
            console.error('Error getting server info:', error);
            return { server: '', playerName: '', isValid: false };
        }
    }
    
    // Проверить сохраненный ключ
    async function checkSavedKey(server, playerName) {
        try {
            const key = await chrome.storage.local.get(['auth_keys']);
            const authKeys = key.auth_keys || {};
            const serverKey = `${server}_${playerName}`;
            
            return authKeys[serverKey] || null;
        } catch (error) {
            console.error('Error checking saved key:', error);
            return null;
        }
    }
    
    // Сохранить ключ
    async function saveKey(server, playerName, key) {
        try {
            const saved = await chrome.storage.local.get(['auth_keys']);
            const authKeys = saved.auth_keys || {};
            const serverKey = `${server}_${playerName}`;
            
            authKeys[serverKey] = {
                key: key,
                timestamp: Date.now(),
                server: server,
                playerName: playerName
            };
            
            await chrome.storage.local.set({ auth_keys: authKeys });
            return true;
        } catch (error) {
            console.error('Error saving key:', error);
            return false;
        }
    }
    
    // Удалить ключ
    async function removeKey(server, playerName) {
        try {
            const saved = await chrome.storage.local.get(['auth_keys']);
            const authKeys = saved.auth_keys || {};
            const serverKey = `${server}_${playerName}`;
            
            delete authKeys[serverKey];
            await chrome.storage.local.set({ auth_keys: authKeys });
            return true;
        } catch (error) {
            console.error('Error removing key:', error);
            return false;
        }
    }
    
    // Запросить ключ с сервера
    async function requestAuthKey(server, playerName) {
        setStatus(STATUS.YELLOW, 'Requesting access...');
        
        try {
            const response = await fetch(AUTH_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    server: server,
                    player_name: playerName,
                    request_time: new Date().toISOString()
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.status === 'confirmed' && result.key) {
                // Сохраняем ключ
                await saveKey(server, playerName, result.key);
                authKey = result.key;
                isAuthorized = true;
                
                setStatus(STATUS.GREEN, 'Access granted');
                return true;
            } else if (result.status === 'denied') {
                setStatus(STATUS.RED, 'Access denied');
                return false;
            } else {
                setStatus(STATUS.RED, 'Invalid response');
                return false;
            }
            
        } catch (error) {
            console.error('Auth request error:', error);
            setStatus(STATUS.RED, 'Auth server error');
            return false;
        }
    }
    
    // Проверить авторизацию
    async function checkAuthorization() {
        // Получаем активную вкладку
        const tab = await getActiveTab();
        const isTravianPage = tab.url && tab.url.includes('travian.com');
        
        if (!isTravianPage) {
            scanBtn.disabled = true;
            rallyScanBtn.disabled = true;
            autoScanToggle.disabled = true;
            setStatus(STATUS.GRAY, 'Open Travian page');
            return false;
        }
        
        // Разблокируем переключатель если на Travian
        autoScanToggle.disabled = false;
        
        // Получаем информацию о сервере и игроке
        const { server, playerName, isValid } = await getServerAndPlayerInfo();
        
        if (!isValid) {
            setStatus(STATUS.GRAY, 'Open Travian page');
            scanBtn.disabled = true;
            rallyScanBtn.disabled = true;
            return false;
        }
        
        currentServer = server;
        currentPlayerName = playerName;
        
        // Проверяем сохраненный ключ
        const savedKey = await checkSavedKey(server, playerName);
        
        if (savedKey && savedKey.key) {
            authKey = savedKey.key;
            isAuthorized = true;
            setStatus(STATUS.GREEN, 'Authorized');
            scanBtn.disabled = false;
            rallyScanBtn.disabled = false;
            return true;
        }
        
        // Запрашиваем новый ключ
        const authorized = await requestAuthKey(server, playerName);
        
        if (authorized) {
            scanBtn.disabled = false;
            rallyScanBtn.disabled = false;
        } else {
            scanBtn.disabled = true;
            rallyScanBtn.disabled = true;
        }
        
        return authorized;
    }
    
    // Получить данные атак для деревни через API
    async function getVillageAttackData(villageId) {
        try {
            //console.log(`Getting attack data for village ${villageId}...`);
            //console.log('Making API call without JWT token...');
            const tab = await getActiveTab();
            
            const result = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: async (params) => {
                    try {
                        console.log('getVillageAttackData: Get attack for village:', params.villageId);
                        //console.log('Origin:', window.location.origin);
                        
                        const response = await fetch(`${window.location.origin}/api/v1/tooltip/incomingTroops`, {
                            method: 'POST',
                            headers: {
                                'Accept': 'application/json, text/javascript, */*; q=0.01',
                                'Content-Type': 'application/json; charset=UTF-8',
                                'X-Requested-With': 'XMLHttpRequest',
                                'x-version': '326.6'
                            },
                            body: JSON.stringify({ villageIds: [params.villageId] })
                        });
                        
                        //console.log('API response status:', response.status);
                        
                        if (!response.ok) {
                            const errorText = await response.text();
                            console.error('getVillageAttackData: API error response:', errorText);
                            throw new Error(`HTTP ${response.status}: ${errorText}`);
                        }
                        
                        const data = await response.json();
                        console.log('getVillageAttackData: API response data:', data);
                        return data;
                    } catch (error) {
                        console.error('getVillageAttackData: API request failed:', error);
                        return { title: null, text: null, error: error.message };
                    }
                },
                args: [{ villageId }]
            });
            
            console.log('getVillageAttackData: API call result:', result);
            const data = result[0]?.result;
            console.log('getVillageAttackData: Parsed attack data:', data);
            
            const parsedData = parseAttackData(data);
            console.log('getVillageAttackData: Final parsed data:', parsedData);
            return parsedData;
            
        } catch (error) {
            console.error('getVillageAttackData: Error getting village attack data:', error);
            return { attacks: 0, raids: 0 };
        }
    }
    
    // Парсинг данных атак из ответа API
    function parseAttackData(apiData) {
        console.log('Parsing attack data:', apiData);
        
        let attacks = 0;
        let raids = 0;
        
        if (apiData?.text) {
            const text = apiData.text.toLowerCase();
            console.log('Text to parse:', text);
            
            // Парсим "Incoming attacks: 3, Incoming raids: 2"
            const attackMatch = text.match(/attacks?:\s*(\d+)/);
            const raidMatch = text.match(/raids?:\s*(\d+)/);
            
            console.log('Attack match:', attackMatch);
            console.log('Raid match:', raidMatch);
            
            if (attackMatch) attacks = parseInt(attackMatch[1]);
            if (raidMatch) raids = parseInt(raidMatch[1]);
            
            // Альтернативный формат: "Incoming raids: 14"
            if (!attackMatch && !raidMatch) {
                const totalMatch = text.match(/\d+/);
                if (totalMatch) {
                    if (text.includes('raid')) {
                        raids = parseInt(totalMatch[0]);
                    } else {
                        attacks = parseInt(totalMatch[0]);
                    }
                }
            }
        }
        
        console.log('Parsed result - attacks:', attacks, 'raids:', raids);
        return { attacks, raids };
    }
    
    // Сканирование деревень
    async function scanVillages() {
        try {
            const tab = await getActiveTab();
            
            const result = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    const villages = [];
                    
                    //console.log('=== POPUP SCAN START ===');
                    //console.log('Document readyState:', document.readyState);
                    //console.log('Page URL:', window.location.href);
					console.log('scanVillages: -------------------------');
                    console.log('scanVillages: Begin -------------------');
                    
                    // Находим все записи деревень в списке
					const villageEntries = document.querySelectorAll('.villageList .listEntry.village');
					console.log('scanVillages: Found village:', villageEntries.length);

					villageEntries.forEach(entry => {
						// Получаем ID из data-did атрибута элемента списка
						const villageId = entry.dataset.did;
						
						// Находим элемент с названием внутри этой записи
						const nameElement = entry.querySelector('.name');
						const villageName = nameElement?.textContent.trim() || 'Unknown Village';
						
						
						//console.log('Processing village:', {
						//	id: villageId,
						//	name: villageName
						//});
						
						// Добавляем только если есть ID
						if (villageId) {
							villages.push({
								id: villageId,
								name: villageName
							});
						}
					});

					console.log('scanVillages: Final villages array:', villages);
                    
                    //console.log('Total villages found:', villages.length);
                    console.log('scanVillages: End ---------------------');
                    
                    return villages;
                }
            });
            
            console.log('??1: Script execution result:', result);
            const villages = result[0]?.result || [];
            console.log('??1: Parsed villages:', villages);
            
            const villageData = [];
            
            // Для каждой деревни получаем данные атак через API
            for (const village of villages) {
                console.log('??1: Processing village:', village);
                const attackData = await getVillageAttackData(village.id);
                console.log('??1: Attack data for village:', village.id, attackData);
                
                const attacks = [];
                if (attackData.attacks > 0) {
                    attacks.push({ type: 'attack', count: attackData.attacks });
                }
                if (attackData.raids > 0) {
                    attacks.push({ type: 'raid', count: attackData.raids });
                }
                
                if (attacks.length > 0) {
                    villageData.push({
                        name: village.name,
                        id: village.id,
                        attacks: attacks
                    });
                }
				
				const delayMs = Math.floor(Math.random() * 31) + 20; // 20-50
				await new Promise(resolve => setTimeout(resolve, delayMs));
            }
            
            console.log('??1: Final village data:', villageData);
            return villageData;
            
        } catch (error) {
            console.error('??1: Error scanning villages:', error);
            return [];
        }
    }
    
    // Сканирование альянса
    async function scanAlliance() {
        try {
            const tab = await getActiveTab();
            
            const result = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    const players = [];
					let rows = [];
                    console.log('scanAlliance: -------------------------');
                    console.log('scanAlliance: Begin -------------------');
                    //console.log('[Travian Scanner] PlayerName = ',currentPlayerName);
                    if (document.querySelectorAll(".allianceMembers").length > 0) {
                        const rows = document.querySelectorAll(".allianceMembers")[0]
                            .getElementsByTagName("tbody")[0]
                            .getElementsByTagName("tr");
                        
                        console.log('scanAlliance: found player: ', rows.length);
                        for (let i = 0; i < rows.length; i++) {
                            const playerNameCell = rows[i].getElementsByClassName("playerName")[0];
                            if (!playerNameCell) continue;
                            
                            const playerName = playerNameCell.innerText.trim();
                            const attackDiv = rows[i].querySelectorAll(".attack");
                            
                            //console.log(`Player ${playerName}, attack divs:`, attackDiv.length);
                            
                            let attackCount = 0;
                            let raidCount = 0;
                            
                            if (attackDiv.length > 0) {
                                const altText = attackDiv[0].alt || '';
                                //console.log('Attack div alt text:', altText);    
                                const parts = altText.split("<br />");
                                
                                if (parts[0]) {
                                    const attackMatch = parts[0].match(/\d+/);
                                    if (attackMatch) {
                                        attackCount = parseInt(attackMatch[0]);
                                    }
                                }
                                
                                if (parts[1]) {
                                    const raidMatch = parts[1].match(/\d+/);
                                    if (raidMatch) {
                                        raidCount = parseInt(raidMatch[0]);
                                    }
                                }
                            }
                            
                            //console.log(`Player ${playerName}: attacks=${attackCount}, raids=${raidCount}`);
                            
                            if (attackCount > 0 || raidCount > 0) {
                                const playerData = {
                                    name: playerName,
                                    attacks: []
                                };
                                console.log(`scanAlliance: Player ${playerName}: attacks=${attackCount}, raids=${raidCount}`);
                                if (attackCount > 0) {
                                    playerData.attacks.push({
                                        type: 'attack',
                                        count: attackCount
                                    });
                                }
                                
                                if (raidCount > 0) {
                                    playerData.attacks.push({
                                        type: 'raid',
                                        count: raidCount
                                    });
                                }
                                
                                players.push(playerData);
                            }
                        }
                    } else {
                        console.log('scanAlliance: No found player: ', rows.length);
                    }
                    
                    console.log('scanAlliance: Total players found:', players.length);
                    console.log('scanAlliance: End -----------------------------');
                    
                    return players;
                }
            });
            
            return result[0]?.result || [];
            
        } catch (error) {
            console.error('scanAlliance: Error scanning alliance:', error);
            return [];
        }
    }
    
    // Отправить данные с авторизацией
    async function sendDataWithAuth(url, data) {
        if (!authKey) {
            throw new Error('No auth key');
        }
		
		const encodedPlayerName = btoa(encodeURIComponent(currentPlayerName));
        
        console.log('Sending data to:', url);
        console.log('Auth key present:', !!authKey);
        console.log('Headers:', {
            'X-Auth-Key': authKey ? 'present' : 'missing',
            'X-Server': currentServer,
            'X-Player-Name': encodedPlayerName
        });
        console.log('Data to send:', JSON.stringify(data, null, 2));
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Key': authKey,
                'X-Server': currentServer,
                'X-Player-Name': encodedPlayerName
            },
            body: JSON.stringify(data)
        });
        
        console.log('Response status:', response.status);
        console.log('Response headers:', Object.fromEntries(response.headers.entries()));
        
        if (response.status === 401) {
            // Неавторизован, удаляем ключ
            await removeKey(currentServer, encodedPlayerName);
            isAuthorized = false;
            authKey = '';
            setStatus(STATUS.RED, 'Session expired');
            scanBtn.disabled = true;
            rallyScanBtn.disabled = true;
            throw new Error('Unauthorized');
        }
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Error response:', errorText);
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        const result = await response.json();
        console.log('Response data:', result);
        return result;
    }
    
// Сбор данных из пункта сбора (Rally Point)
async function scanRallyPoint() {
    try {
        const tab = await getActiveTab();
        
        const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (currentPlayerName, currentServer) => {
                console.log('scanRallyPoint: -------------------------');
                console.log('scanRallyPoint: Begin -------------------');
                
                const movementInfo = [];
                let targetInfo = {
                    village_name: null,
                    village_id: null,
                    village_coordinates: { x: null, y: null }
                };
                
                // Находим контейнер с данными пункта сбора
                const rallyContainer = document.querySelector('.data.rallyPointOverviewContainer');
                if (!rallyContainer) {
                    console.log('scanRallyPoint: Rally point container not found');
                    return { movement_info: [] };
                }
                
                // Получаем информацию о целевой деревне из нижней таблицы
                const ownTroopsTable = rallyContainer.querySelector('table.troop_details[data-player-name]');
                if (ownTroopsTable) {
                    const villageLink = ownTroopsTable.querySelector('thead td.role a');
                    const coordsElement = ownTroopsTable.querySelector('tbody.units th.coords');
                    
                    targetInfo = {
                        village_name: villageLink?.textContent?.trim() || null,
                        village_id: ownTroopsTable.getAttribute('data-did'),
                        village_coordinates: { x: null, y: null }
                    };
                    
                    // Получаем координаты целевой деревни
                    if (coordsElement) {
                        const coordsText = coordsElement.textContent || '';
                        console.log('scanRallyPoint: Target coords raw:', coordsText);
                        
                        // Заменяем специальный символ минуса на обычный дефис и удаляем спецсимволы
                        const normalizedCoords = coordsText
                            .replace(/−/g, '-')           // заменяем спец-минус на обычный
                            .replace(/[‭‬]/g, '');         // удаляем другие спецсимволы
                        
                        console.log('scanRallyPoint: Target normalized coords:', normalizedCoords);
                        
                        // Ищем все числа (теперь с обычным минусом)
                        const numbers = normalizedCoords.match(/-?\d+/g);
                        if (numbers && numbers.length >= 2) {
                            targetInfo.village_coordinates = {
                                x: parseInt(numbers[0], 10),
                                y: parseInt(numbers[1], 10)
                            };
                            console.log('scanRallyPoint: Target parsed coords from numbers:', numbers);
                        }
                        
                        console.log('scanRallyPoint: Target parsed coords:', targetInfo.village_coordinates);
                    }
                    
                    console.log('scanRallyPoint: Target info:', targetInfo);
                }
                
                // Находим все таблицы с перемещениями (InRaid, InAttack, OutSupply, InSupply)
                const movementTables = rallyContainer.querySelectorAll('table.troop_details.inRaid, table.troop_details.inAttack, table.troop_details.outSupply, table.troop_details.inSupply');
                console.log('scanRallyPoint: Found movement tables:', movementTables.length);
                
                movementTables.forEach((table, index) => {
                    try {
                        // Определяем тип перемещения из класса таблицы
                        const tableClass = table.className;
                        let typeMovement = '';
                        if (tableClass.includes('inRaid')) typeMovement = 'InRaid';
                        else if (tableClass.includes('inAttack')) typeMovement = 'InAttack';
                        else if (tableClass.includes('outSupply')) typeMovement = 'OutSupply';
                        else if (tableClass.includes('inSupply')) typeMovement = 'InSupply';
                        
                        // Получаем информацию об отправителе (атакующем)
                        const senderCell = table.querySelector('thead td.role a');
                        const senderName = senderCell?.textContent?.trim() || 'Unknown';
                        const senderHref = senderCell?.getAttribute('href') || '';
                        const senderVillageId = senderHref.match(/d=(\d+)/)?.[1] || null;
                        
                        // Получаем координаты атакующего
                        const coordsElement = table.querySelector('tbody.units th.coords');
                        let senderCoordinates = { x: null, y: null };
                        
                        if (coordsElement) {
                            const coordsText = coordsElement.textContent || '';
                            console.log(`scanRallyPoint: Sender ${index + 1} coords raw:`, coordsText);
                            
                            // Заменяем специальный символ минуса на обычный дефис и удаляем спецсимволы
                            const normalizedCoords = coordsText
                                .replace(/−/g, '-')           // заменяем спец-минус на обычный
                                .replace(/[‭‬]/g, '');         // удаляем другие спецсимволы
                            
                            console.log(`scanRallyPoint: Sender ${index + 1} normalized coords:`, normalizedCoords);
                            
                            // Ищем все числа (теперь с обычным минусом)
                            const numbers = normalizedCoords.match(/-?\d+/g);
                            if (numbers && numbers.length >= 2) {
                                senderCoordinates = {
                                    x: parseInt(numbers[0], 10),
                                    y: parseInt(numbers[1], 10)
                                };
                                console.log(`scanRallyPoint: Sender ${index + 1} parsed coords from numbers:`, numbers);
                            }
                            
                            console.log(`scanRallyPoint: Sender ${index + 1} parsed coords:`, senderCoordinates);
                        }
                        
                        // Получаем информацию о времени прибытия
                        const timerElement = table.querySelector('tbody.infos .timer');
                        const arrivalInSeconds = timerElement ? parseInt(timerElement.getAttribute('value') || '0') : 0;
                        
                        const atElement = table.querySelector('tbody.infos .at span:first-child');
                        let arrivalAt = atElement?.textContent?.trim() || '';
                        arrivalAt = arrivalAt.replace(/[^\d:]/g, '');
                        
                        // Получаем все типы юнитов и их количество
                        const unitIcons = table.querySelectorAll('tbody.units .uniticon img');
                        const troopCells = table.querySelectorAll('tbody.units.last td.unit');
                        
                        const troops = [];
                        
                        // Собираем информацию по каждому юниту
                        unitIcons.forEach((icon, idx) => {
                            if (idx < troopCells.length) {
                                // Получаем класс юнита из атрибута class иконки
                                const iconClass = icon.getAttribute('class') || '';
                                
                                // Ищем класс, начинающийся с 'u' и не 'uhero'
                                const classMatch = iconClass.match(/\b(u\d+)\b/);
                                let unitType = classMatch ? classMatch[1] : null;
                                
                                if (unitType) {
                                    const countCell = troopCells[idx];
                                    const count = countCell?.textContent?.trim() || '0';
                                    troops.push({
                                        type: unitType,
                                        count: count === '?' ? '?' : parseInt(count) || 0
                                    });
                                }
                            }
                        });
                        
                        // Получаем информацию о герое (последняя ячейка)
                        if (troopCells.length > 0) {
                            const heroCell = troopCells[troopCells.length - 1];
                            const heroText = heroCell?.textContent?.trim() || '0';
                            troops.push({
                                type: 'uhero',
                                count: heroText === '?' ? '?' : parseInt(heroText) || 0
                            });
                        }
                        
                        // Формируем объект перемещения
                        movementInfo.push({
                            id: index + 1,
                            type_movement: typeMovement,
                            sender: {
                                village_name: senderName,
                                village_id: senderVillageId,
                                village_coordinates: senderCoordinates
                            },
                            target: {
                                village_name: targetInfo.village_name,
                                village_id: targetInfo.village_id,
                                village_coordinates: targetInfo.village_coordinates
                            },
                            arrival: {
                                in_seconds: arrivalInSeconds,
                                at_time: arrivalAt
                            },
                            troops: troops,
                            account: {
                                server: currentServer,
                                player_name: currentPlayerName
                            }
                        });
                        
                    } catch (error) {
                        console.error('scanRallyPoint: Error processing movement table:', error);
                    }
                });
                
                console.log('scanRallyPoint: Collected movements:', JSON.stringify(movementInfo, null, 2));
                console.log('scanRallyPoint: End -----------------------');
                
                return { movement_info: movementInfo };
                
            },
            args: [currentPlayerName, currentServer]
        });
        
        const scanResult = result[0]?.result || { movement_info: [] };
        console.log('scanRallyPoint: Final result:', JSON.stringify(scanResult, null, 2));
        
        return scanResult;
        
    } catch (error) {
        console.error('scanRallyPoint: Error scanning rally point:', error);
        return { movement_info: [] };
    }
}
  
    // Сканирование и отправка данных (основной сканер)
    async function scanAndSend() {
        if (!isAuthorized || isScanning) return;
        
        console.log('=== SCAN AND SEND START ===');
        console.log('Authorized:', isAuthorized);
        console.log('Current server:', currentServer);
        console.log('Current player:', currentPlayerName);
        
        isScanning = true;
        scanBtn.disabled = true;
        rallyScanBtn.disabled = true;
        setStatus(STATUS.YELLOW, 'Scanning...');
        
        try {
            const tab = await getActiveTab();
            console.log('Current tab:', tab);
            
            if (!tab.url.includes('travian.com')) {
                console.log('Not a Travian page:', tab.url);
                showStatus('Open Travian', 'error');
                return;
            }
            
            console.log('Starting village scan...');
            // Сканируем деревни
            const villageData = await scanVillages();
            console.log('Village scan complete, found:', villageData.length);
            
            console.log('Starting alliance scan...');
            // Сканируем альянс
            const allianceData = await scanAlliance();
            console.log('Alliance scan complete, found:', allianceData.length);
            
            // Отправляем данные на сервер
            const results = [];
            
            if (villageData.length > 0) {
                console.log('Sending village data...');
                try {
                    const result = await sendDataWithAuth(ATTACKS_API_URL, {
                        message_id: `village_${Date.now()}`,
                        type: 'village',
                        data: villageData,
                        metadata: {
                            server: currentServer,
                            player: currentPlayerName,
                            source: 'manual_scan',
                            page: tab.url
                        }
                    });
                    console.log('Village data sent successfully');
                    results.push({ type: 'village', success: true });
                } catch (error) {
                    console.error('Error sending village data:', error);
                    results.push({ type: 'village', success: false, error: error.message });
                }
            }
            
            if (allianceData.length > 0) {
                console.log('Sending alliance data...');
                try {
                    const result = await sendDataWithAuth(ATTACKS_API_URL, {
                        message_id: `alliance_${Date.now()}`,
                        type: 'alliance',
                        data: allianceData,
                        metadata: {
                            server: currentServer,
                            player: currentPlayerName,
                            source: 'manual_scan',
                            page: tab.url
                        }
                    });
                    console.log('Alliance data sent successfully');
                    results.push({ type: 'alliance', success: true });
                } catch (error) {
                    console.error('Error sending alliance data:', error);
                    results.push({ type: 'alliance', success: false, error: error.message });
                }
            }
            
            const successCount = results.filter(r => r.success).length;
            const totalCount = results.length;
            
            console.log('Results:', results);
            
            if (totalCount === 0) {
                console.log('No data to send');
                setStatus(STATUS.GREEN, 'No attacks found');
            } else if (successCount === totalCount) {
                console.log('All data sent successfully');
                setStatus(STATUS.GREEN, `Sent ${successCount} report(s)`);
            } else {
                console.log('Partial success');
                setStatus(STATUS.YELLOW, `${successCount}/${totalCount} sent`);
            }
            
        } catch (error) {
            console.error('Scan error:', error);
            setStatus(STATUS.RED, 'Scan failed');
        } finally {
            isScanning = false;
            scanBtn.disabled = !isAuthorized;
            rallyScanBtn.disabled = !isAuthorized;
            console.log('=== SCAN AND SEND END ===');
            
            // Автозакрытие через 10 секунд при успехе
            setTimeout(() => {
                if (statusIndicator.classList.contains('status-green')) {
                    window.close();
                }
            }, 10000);
        }
    }
    
    // Сканирование пункта сбора и отправка данных
async function scanRallyAndSend() {
    if (!isAuthorized || isRallyScanning) return;
    
    console.log('=== RALLY POINT SCAN START ===');
    console.log('Authorized:', isAuthorized);
    console.log('Current server:', currentServer);
    console.log('Current player:', currentPlayerName);
    
    isRallyScanning = true;
    scanBtn.disabled = true;
    rallyScanBtn.disabled = true;
    setStatus(STATUS.YELLOW, 'Scanning Rally Point...');
    
    try {
        const tab = await getActiveTab();
        console.log('Current tab:', tab);
        
        if (!tab.url.includes('travian.com')) {
            console.log('Not a Travian page:', tab.url);
            showStatus('Open Travian', 'error');
            return;
        }
        
        // Проверяем, что мы на странице пункта сбора
        if (!tab.url.includes('gid=16')) {
            console.log('Not on Rally Point page');
            setStatus(STATUS.RED, 'Open Rally Point first');
            return;
        }
        
        console.log('Starting rally point scan...');
        const scanResult = await scanRallyPoint();
        console.log('Rally point scan complete, movements:', scanResult.movement_info.length);
        
        if (scanResult.movement_info.length === 0) {
            setStatus(STATUS.GREEN, 'No movements found');
            return;
        }
        
        // Отправляем данные на сервер
        console.log('Sending rally point data...');
        try {
            const result = await sendDataWithAuth(RALLY_API_URL, {
                message_id: `rally_${Date.now()}`,
                type: 'rally_point',
                movement_info: scanResult.movement_info,
                metadata: {
                    server: currentServer,
                    player: currentPlayerName,
                    source: 'manual_scan',
                    page: tab.url,
                    scan_time: new Date().toISOString(),
                    total_movements: scanResult.movement_info.length
                }
            });
            console.log('Rally point data sent successfully');
            setStatus(STATUS.GREEN, `Sent ${scanResult.movement_info.length} movement(s)`);
        } catch (error) {
            console.error('Error sending rally point data:', error);
            setStatus(STATUS.RED, 'Send failed');
        }
        
    } catch (error) {
        console.error('Rally point scan error:', error);
        setStatus(STATUS.RED, 'Scan failed');
    } finally {
        isRallyScanning = false;
        scanBtn.disabled = !isAuthorized;
        rallyScanBtn.disabled = !isAuthorized;
        console.log('=== RALLY POINT SCAN END ===');
        
        // Автозакрытие через 10 секунд при успехе
        setTimeout(() => {
            if (statusIndicator.classList.contains('status-green')) {
                window.close();
            }
        }, 10000);
    }
}
    
    // Загрузка настроек
    async function loadSettings() {
        const settings = await chrome.storage.local.get(['autoScan']);
        console.log('[Popup] Loading settings from storage:', settings);
        autoScanToggle.checked = settings.autoScan || false;
    }
    
    // Сохранение настроек
    function saveSettings() {
        const newValue = autoScanToggle.checked;
        console.log('[Popup] Saving auto-scan setting:', newValue);
        chrome.storage.local.set({
            autoScan: newValue
        });
    }
    
    // Инициализация
    async function init() {
        setStatus(STATUS.GRAY, 'Checking...');
        await loadSettings();
        
        const settings = await chrome.storage.local.get(['autoScan']);
        console.log('[Popup] Current auto-scan setting:', settings.autoScan);
        
        // Получаем информацию о текущей вкладке
        const tab = await getActiveTab();
        const isTravianPage = tab.url && tab.url.includes('travian.com');
        
        // Блокируем элементы управления если не на Travian
        if (!isTravianPage) {
            scanBtn.disabled = true;
            rallyScanBtn.disabled = true;
            autoScanToggle.disabled = true;
            setStatus(STATUS.GRAY, 'Open Travian page');
            return;
        }
        
        // Разблокируем переключатель
        autoScanToggle.disabled = false;
        
        // Проверяем авторизацию
        await checkAuthorization();
        
        // Показываем статус автосканирования
        if (settings.autoScan && isAuthorized) {
            setStatus(STATUS.GREEN, 'Auto-scan enabled');
        }
    }
    
    // При фокусе на popup обновляем статус
    window.addEventListener('focus', async () => {
        // Получаем текущую активную вкладку
        const tab = await getActiveTab();
        const isTravianPage = tab.url && tab.url.includes('travian.com');
        
        if (!isTravianPage) {
            scanBtn.disabled = true;
            rallyScanBtn.disabled = true;
            autoScanToggle.disabled = true;
            setStatus(STATUS.GRAY, 'Open Travian page');
            return;
        }
        
        // Разблокируем элементы если на Travian
        autoScanToggle.disabled = false;
        
        if (currentServer) {
            await checkAuthorization();
        }
    });
    
    // Обработчики событий
    scanBtn.addEventListener('click', scanAndSend);
    rallyScanBtn.addEventListener('click', scanRallyAndSend);
    
    autoScanToggle.addEventListener('change', () => {
        // Проверяем что мы на Travian странице перед сохранением
        getActiveTab().then(tab => {
            if (!tab.url || !tab.url.includes('travian.com')) {
                autoScanToggle.checked = !autoScanToggle.checked; // отменяем переключение
                showStatus('Open Travian page first', 'error');
                return;
            }
            saveSettings();
            const statusText = autoScanToggle.checked ? 'Auto-scan enabled' : 'Auto-scan disabled';
            showStatus(statusText, 'info');
            setStatus(autoScanToggle.checked ? STATUS.GREEN : STATUS.YELLOW, statusText);
        }).catch(error => {
            console.error('Error checking tab:', error);
        });
    });
    
    // Инициализируем
    init();
});