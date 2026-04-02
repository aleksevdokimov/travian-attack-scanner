document.addEventListener('DOMContentLoaded', function() {
    // Элементы для переключения состояний
    const unauthState = document.getElementById('unauthState');
    const authState = document.getElementById('authState');
    
    // Элементы активации (остаются в unauthState)
    const playerInfo = document.getElementById('playerInfo');
    const verificationCodeInput = document.getElementById('verificationCode');
    const activateBtn = document.getElementById('activateBtn');
    const activationMessage = document.getElementById('activationMessage');
    const activatedBadge = document.getElementById('activatedBadge');
    const activationInputGroup = document.getElementById('activationInputGroup');
    
    // Элементы авторизованного состояния
    const scanBtn = document.getElementById('scanBtn');
    const rallyScanBtn = document.getElementById('rallyScanBtn');
    const statusMessage = document.getElementById('statusMessage');
    const statusIndicator = document.getElementById('statusIndicator');
    const autoScanToggle = document.getElementById('autoScanToggle');
    
    const API_URL = 'http://127.0.0.1:8000';
    const AUTH_API_URL = `${API_URL}/game/api/auth/key`;
    const ATTACKS_API_URL = `${API_URL}/game/api/attacks`;
    const RALLY_API_URL = `${API_URL}/game/api/rally-point`;
    const VERIFY_API_URL = `${API_URL}/game/browser/verify`;
    
    let isScanning = false;
    let isRallyScanning = false;
    let currentServer = '';
    let currentPlayerName = '';
    let currentPlayerAccountId = null;
    let authKey = '';
    let isAuthorized = false;
    let isActivated = false;
    let currentTabId = null;
    
    // Функция переключения UI между состояниями
    function switchToUnauthState() {
        unauthState.classList.remove('state-hidden');
        unauthState.style.display = 'block';
        authState.style.display = 'none';
        authState.classList.add('state-hidden');
    }
    
    function switchToAuthState() {
        unauthState.style.display = 'none';
        unauthState.classList.add('state-hidden');
        authState.classList.remove('state-hidden');
        authState.style.display = 'block';
    }
    
    // Состояния индикатора
    const STATUS = {
        GREEN: 'green',
        YELLOW: 'yellow',
        RED: 'red',
        GRAY: 'gray'
    };
    
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
    
    function showStatus(message, type = 'info') {
        statusMessage.textContent = message;
        statusMessage.className = `status-message status-${type}`;
    }
    
    function showActivationMessage(message, type = 'info') {
        activationMessage.textContent = message;
        activationMessage.className = `activation-message ${type}`;
        activationMessage.style.display = 'block';
        
        setTimeout(() => {
            activationMessage.style.display = 'none';
        }, 3000);
    }
    
    async function getActiveTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab;
    }
    
    // Получение информации об игроке со страницы
    async function getPlayerInfoFromPage() {
        try {
            const tab = await getActiveTab();
            
            if (!tab.url.includes('travian.com')) {
                return { server: '', playerName: '', playerAccountId: null, isValid: false };
            }
            
            const result = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    const server = window.location.hostname;
                    
                    // Получаем имя игрока
                    let playerName = '';
                    const villageBoxes = document.getElementById('villageBoxes');
                    if (villageBoxes) {
                        const playerNameElement = villageBoxes.querySelector('.playerName');
                        if (playerNameElement) {
                            playerName = playerNameElement.textContent.trim();
                        }
                    }
                    
                    // Получаем account_id из ссылки на профиль
                    let playerAccountId = null;
                    // Ищем ссылку на профиль игрока
                    const profileLinks = document.querySelectorAll('a[href^="/profile/"]');
                    for (const link of profileLinks) {
                        const linkText = link.textContent.trim();
                        if (linkText === playerName) {
                            const match = link.getAttribute('href').match(/\/profile\/(\d+)/);
                            if (match) {
                                playerAccountId = parseInt(match[1]);
                                break;
                            }
                        }
                    }
                    
                    // Если не нашли по имени, берём первую попавшуюся ссылку на профиль
                    if (!playerAccountId && profileLinks.length > 0) {
                        const match = profileLinks[0].getAttribute('href').match(/\/profile\/(\d+)/);
                        if (match) {
                            playerAccountId = parseInt(match[1]);
                        }
                    }
                    
                    console.log('[Popup] Player info:', { playerName, playerAccountId, server });
                    return { server, playerName, playerAccountId, isValid: !!playerName };
                }
            });
            
            return result[0]?.result || { server: '', playerName: '', playerAccountId: null, isValid: false };
            
        } catch (error) {
            console.error('Error getting player info:', error);
            return { server: '', playerName: '', playerAccountId: null, isValid: false };
        }
    }
    
    // Проверка статуса активации (только локальная)
    async function checkActivationStatus() {
        if (!currentPlayerAccountId || !currentServer) {
            return false;
        }
        
        try {
            const tab = await getActiveTab();
            const result = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: (playerName, serverUrl) => {
                    const activatedKey = `activated_${serverUrl}_${playerName}`;
                    const isActivated = localStorage.getItem(activatedKey) === 'true';
                    console.log('[Content] checkActivationStatus:', playerName, serverUrl, isActivated);
                    return isActivated;
                },
                args: [currentPlayerName, currentServer]
            });
            
            return result[0]?.result || false;
            
        } catch (error) {
            console.error('Error checking activation status:', error);
            return false;
        }
    }
    
    // Обновление UI секции активации
    async function updateActivationUI() {
        console.log('[Popup] updateActivationUI - currentPlayerName:', currentPlayerName);
        console.log('[Popup] updateActivationUI - currentPlayerAccountId:', currentPlayerAccountId);
        
        if (!currentPlayerName || !currentPlayerAccountId) {
            playerInfo.innerHTML = '<span>❌ Не удалось определить игрока</span>';
            activationInputGroup.style.display = 'none';
            activatedBadge.style.display = 'none';
            return;
        }
        
        playerInfo.innerHTML = `<span>🎮 ${escapeHtml(currentPlayerName)}</span> (ID: ${currentPlayerAccountId})`;
        
        const isActivatedLocal = await checkActivationStatus();
        
        console.log('[Popup] updateActivationUI - isActivatedLocal:', isActivatedLocal);
        
        if (isActivatedLocal) {
            activationInputGroup.style.display = 'none';
            activatedBadge.style.display = 'flex';
            isActivated = true;
            
            // Если уже активирован, но ключа нет — запросим ключ
            const savedKey = await checkSavedKey(currentServer, currentPlayerName);
            if (!savedKey || !savedKey.key) {
                console.log('[Popup] Activated but no key, requesting...');
                const authorized = await requestAuthKey(currentServer, currentPlayerName);
                if (authorized) {
                    // Переключаемся на авторизованное состояние
                    switchToAuthState();
                }
            } else {
                // Уже есть ключ, переключаемся
                authKey = savedKey.key;
                isAuthorized = true;
                switchToAuthState();
            }
        } else {
            activationInputGroup.style.display = 'flex';
            activatedBadge.style.display = 'none';
            isActivated = false;
            // Показываем состояние активации
            switchToUnauthState();
        }
    }
    
    // Отправка запроса на активацию
    async function sendActivationRequest() {
        const
        code = verificationCodeInput.value.trim().toUpperCase();
        
        console.log('[Popup] === sendActivationRequest START ===');
        console.log('[Popup] Code entered:', code ? `${code.substring(0, 2)}***` : 'EMPTY');
        console.log('[Popup] currentPlayerAccountId:', currentPlayerAccountId);
        console.log('[Popup] currentServer:', currentServer);
        console.log('[Popup] currentPlayerName:', currentPlayerName);
        
        if (!code) {
            showActivationMessage('Введите код подтверждения', 'warning');
            return;
        }
        
        if (code.length < 4 || code.length > 10) {
            showActivationMessage('Код должен быть от 4 до 10 символов', 'warning');
            return;
        }
        
        if (!currentPlayerAccountId) {
            showActivationMessage('Не удалось определить ID игрока', 'error');
            return;
        }
        
        activateBtn.disabled = true;
        activateBtn.textContent = 'Проверка...';
        
        try {
            const fullServerUrl = `https://${currentServer}/`;
            
            console.log('[Popup] Sending verification request...');
            console.log('[Popup] VERIFY_API_URL:', VERIFY_API_URL);
            console.log('[Popup] Request body:', {
                verification_code: code,
                player_account_id: currentPlayerAccountId,
                server_url: fullServerUrl
            });
            
            const response = await fetch(VERIFY_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    verification_code: code,
                    player_account_id: currentPlayerAccountId,
                    server_url: fullServerUrl
                })
            });
            
            console.log('[Popup] Response status:', response.status, response.statusText);
            
            // Получаем текст ответа для отладки
            const responseText = await response.text();
            console.log('[Popup] Response text:', responseText);
            
            let data;
            try {
                data = JSON.parse(responseText);
            } catch (e) {
                console.error('[Popup] Failed to parse JSON:', e);
                data = { success: false, message: 'Invalid server response' };
            }
            
            console.log('[Popup] Parsed response data:', data);
            
            if (response.ok && data.success) {
                console.log('[Popup] ✅ Activation SUCCESS!');
                showActivationMessage('✅ Аккаунт подтверждён!', 'success');
                
                // Сохраняем API-ключ
                if (data.api_key) {
                    console.log('[Popup] Saving API key:', data.api_key.substring(0, 10) + '...');
                    await saveKey(currentServer, currentPlayerName, data.api_key);
                    authKey = data.api_key;
                    isAuthorized = true;
                    console.log('[Popup] ✅ API key saved');
                } else {
                    console.log('[Popup] ⚠️ No api_key in response! Response:', data);
                    showActivationMessage('⚠️ Ключ не получен, но аккаунт подтверждён', 'warning');
                }
                
                // Сохраняем статус активации в localStorage страницы
                console.log('[Popup] Saving activation to localStorage...');
                const tab = await getActiveTab();
                console.log('[Popup] Active tab id:', tab.id);
                
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: (playerName, serverUrl) => {
                        const activatedKey = `activated_${serverUrl}_${playerName}`;
                        localStorage.setItem(activatedKey, 'true');
                        console.log('[Content] ✅ Saved activation to localStorage:', activatedKey);
                        return true;
                    },
                    args: [currentPlayerName, currentServer]
                });
                
                console.log('[Popup] Updating UI...');
                
                // Переключаемся на авторизованное состояние
                switchToAuthState();
                
                // Обновляем UI
                activationInputGroup.style.display = 'none';
                activatedBadge.style.display = 'flex';
                isActivated = true;
                
                // Обновляем статус авторизации
                setStatus(STATUS.GREEN, 'Authorized');
                scanBtn.disabled = false;
                rallyScanBtn.disabled = false;
                
                // Очищаем поле ввода
                verificationCodeInput.value = '';
                
                // Закрываем окно через 2 секунды
                setTimeout(() => {
                    window.close();
                }, 2000);
                
            } else {
                console.log('[Popup] ❌ Activation FAILED:', data.message || 'Unknown error');
                showActivationMessage(data.message || '❌ Неверный код подтверждения', 'error');
                verificationCodeInput.value = '';
                verificationCodeInput.focus();
            }
            
        } catch (error) {
            console.error('[Popup] ❌ Activation error:', error);
            console.error('[Popup] Error name:', error.name);
            console.error('[Popup] Error message:', error.message);
            showActivationMessage('❌ Ошибка подключения к серверу', 'error');
        } finally {
            console.log('[Popup] === sendActivationRequest END ===');
            activateBtn.disabled = false;
            activateBtn.textContent = 'Подтвердить';
        }
    }
    
    // Получить JWT токен через background script
    async function getJwtToken() {
        try {
            console.log('[Popup] Getting JWT token...');
            const tab = await getActiveTab();
            
            let response;
            try {
                response = await chrome.runtime.sendMessage({
                    type: 'GET_JWT_TOKEN'
                });
            } catch (runtimeError) {
                const errorMsg = runtimeError.message || runtimeError.toString();
                if (errorMsg.includes('Extension context invalidated') || 
                    errorMsg.includes('context invalidated')) {
                    console.warn('[Popup] Extension context invalidated');
                    return null;
                }
                throw runtimeError;
            }
            
            return response?.token;
        } catch (error) {
            console.error('[Popup] Error getting JWT:', error);
            return null;
        }
    }
    
    // Получить информацию о сервере и игроке со страницы
    async function getServerAndPlayerInfo() {
        const info = await getPlayerInfoFromPage();
        return { 
            server: info.server, 
            playerName: info.playerName, 
            isValid: info.isValid 
        };
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
        const tab = await getActiveTab();
        const isTravianPage = tab.url && tab.url.includes('travian.com');
        
        if (!isTravianPage) {
            // Не на Travian — показываем состояние "не авторизован" с сообщением
            playerInfo.innerHTML = '<span>❌ Откройте страницу Travian</span>';
            switchToUnauthState();
            return false;
        }
        
        autoScanToggle.disabled = false;
        
        // Получаем информацию об игроке заново, чтобы обновить currentPlayerAccountId
        const playerInfoData = await getPlayerInfoFromPage();
        currentServer = playerInfoData.server;
        currentPlayerName = playerInfoData.playerName;
        currentPlayerAccountId = playerInfoData.playerAccountId;
        
        console.log('[Popup] checkAuthorization - Player info:', {
            server: currentServer,
            playerName: currentPlayerName,
            playerAccountId: currentPlayerAccountId,
            isValid: playerInfoData.isValid
        });
        
        if (!playerInfoData.isValid || !currentPlayerName) {
            setStatus(STATUS.GRAY, 'Cannot identify player');
            scanBtn.disabled = true;
            rallyScanBtn.disabled = true;
            return false;
        }
        
        // Проверяем сохранённый ключ
        const savedKey = await checkSavedKey(currentServer, currentPlayerName);
        
        if (savedKey && savedKey.key) {
            authKey = savedKey.key;
            isAuthorized = true;
            setStatus(STATUS.GREEN, 'Authorized');
            scanBtn.disabled = false;
            rallyScanBtn.disabled = false;
            switchToAuthState();
            return true;
        }
        
        // Проверяем, активирован ли игрок (через localStorage)
        const isActivated = await checkActivationStatus();
        console.log('[Popup] checkAuthorization - isActivated:', isActivated);
        
        if (isActivated) {
            // Запрашиваем ключ
            const authorized = await requestAuthKey(currentServer, currentPlayerName);
            if (authorized) {
                switchToAuthState();
                return true;
            }
        }
        
        // Не авторизован — показываем форму активации
        await updateActivationUI();
        switchToUnauthState();
        return false;
    }
    
    // Получить данные атак для деревни через API
    async function getVillageAttackData(villageId) {
        try {
            const tab = await getActiveTab();
            
            const result = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: async (params) => {
                    try {
                        console.log('getVillageAttackData: Get attack for village:', params.villageId);
                        
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
                        
                        // Добавляем только если есть ID
                        if (villageId) {
                            villages.push({
                                id: villageId,
                                name: villageName
                            });
                        }
                    });

                    console.log('scanVillages: Final villages array:', villages);
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
                            
                            let attackCount = 0;
                            let raidCount = 0;
                            
                            if (attackDiv.length > 0) {
                                const altText = attackDiv[0].alt || '';
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
                            
                            console.log(`scanAlliance: Player ${playerName}: attacks=${attackCount}, raids=${raidCount}`);
                            
                            if (attackCount > 0 || raidCount > 0) {
                                const playerData = {
                                    name: playerName,
                                    attacks: []
                                };
                                
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
                                .replace(/−/g, '-')
                                .replace(/[‭‬]/g, '');
                            
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
                                    .replace(/−/g, '-')
                                    .replace(/[‭‬]/g, '');
                                
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
    
    // Экранирование HTML
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Инициализация
    async function init() {
        // По умолчанию показываем состояние авторизации (оно скрыто, пока не проверим)
        authState.style.display = 'none';
        unauthState.style.display = 'block';
        
        setStatus(STATUS.GRAY, 'Checking...');
        await loadSettings();
        
        const tab = await getActiveTab();
        const isTravianPage = tab.url && tab.url.includes('travian.com');
        
        if (!isTravianPage) {
            playerInfo.innerHTML = '<span>❌ Откройте страницу Travian</span>';
            switchToUnauthState();
            return;
        }
        
        autoScanToggle.disabled = false;
        
        // Получаем информацию об игроке
        const playerInfoData = await getPlayerInfoFromPage();
        currentServer = playerInfoData.server;
        currentPlayerName = playerInfoData.playerName;
        currentPlayerAccountId = playerInfoData.playerAccountId;
        
        // Обновляем UI активации
        await updateActivationUI();
        
        // Проверяем авторизацию
        await checkAuthorization();
        
        const settings = await chrome.storage.local.get(['autoScan']);
        if (settings.autoScan && isAuthorized) {
            setStatus(STATUS.GREEN, 'Auto-scan enabled');
        }
    }
    
    // Обработчики событий
    scanBtn.addEventListener('click', scanAndSend);
    rallyScanBtn.addEventListener('click', scanRallyAndSend);
    activateBtn.addEventListener('click', sendActivationRequest);
    
    verificationCodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendActivationRequest();
        }
    });
    
    autoScanToggle.addEventListener('change', () => {
        getActiveTab().then(tab => {
            if (!tab.url || !tab.url.includes('travian.com')) {
                autoScanToggle.checked = !autoScanToggle.checked;
                showStatus('Open Travian page first', 'error');
                return;
            }
            saveSettings();
            const statusText = autoScanToggle.checked ? 'Auto-scan enabled' : 'Auto-scan disabled';
            showStatus(statusText, 'info');
            setStatus(autoScanToggle.checked ? STATUS.GREEN : STATUS.YELLOW, statusText);
        });
    });
    
    window.addEventListener('focus', async () => {
        const tab = await getActiveTab();
        const isTravianPage = tab.url && tab.url.includes('travian.com');
        
        if (!isTravianPage) {
            playerInfo.innerHTML = '<span>❌ Откройте страницу Travian</span>';
            switchToUnauthState();
            return;
        }
        
        if (currentServer) {
            await checkAuthorization();
        }
    });
    
    // Инициализируем
    init();
});