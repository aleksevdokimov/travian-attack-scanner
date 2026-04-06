// content.js
// Автоматическое сканирование при загрузке страницы Travian
if (window.location.href.includes('travian.com')) {
    
    let isScanning = false;
    let lastScanTime = 0;
    const MIN_SCAN_INTERVAL = 2000; // 2 секунды между сканированиями
    let scanTimeout = null;
    let autoScanEnabled = false;
    let isInitialized = false; // Флаг для предотвращения множественной инициализации
    
    // Загружаем настройки автосканирования
    async function loadAutoScanSettings() {
        try {
            const result = await chrome.storage.local.get(['autoScan']);
            autoScanEnabled = result.autoScan || false;
            console.log('[Travian Scanner] Auto-scan setting loaded:', autoScanEnabled);
            
            // ВАЖНО: Всегда обновляем состояние при загрузке
            if (autoScanEnabled) {
                startPeriodicAutoScan();
                // Запускаем первое сканирование через 5 секунд
                setTimeout(() => {
                    if (autoScanEnabled && !isScanning) {
                        console.log('[Travian Scanner] Initial auto-scan after page load');
                        scanPageForAttacks();
                    }
                }, 5000);
            } else {
                stopPeriodicAutoScan();
            }
            
            return autoScanEnabled;
        } catch (error) {
            console.error('[Travian Scanner] Error loading settings:', error);
            return false;
        }
    }
    
    // Запуск периодического автосканирования
    function startPeriodicAutoScan() {
        console.log('[Travian Scanner] Starting periodic auto-scan...');
        
        // Останавливаем предыдущий таймер, если есть
        if (scanTimeout) {
            clearTimeout(scanTimeout);
            scanTimeout = null;
        }
        
        // Случайный интервал от 30 до 90 секунд
        const randomInterval = Math.floor(Math.random() * 60000) + 30000; // 30-90 секунд
        console.log(`[Travian Scanner] Next auto-scan in ${randomInterval / 1000} seconds`);
        
        scanTimeout = setTimeout(() => {
            if (autoScanEnabled && !isScanning) {
                console.log('[Travian Scanner] Periodic auto-scan triggered');
                scanPageForAttacks();
            }
            // Планируем следующий запуск, только если автосканирование включено
            if (autoScanEnabled) {
                startPeriodicAutoScan();
            }
        }, randomInterval);
    }
    
    // Остановка периодического автосканирования
    function stopPeriodicAutoScan() {
        console.log('[Travian Scanner] Stopping periodic auto-scan');
        if (scanTimeout) {
            clearTimeout(scanTimeout);
            scanTimeout = null;
        }
    }
    
    // Слушаем изменения настроек
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.autoScan) {
            const newValue = changes.autoScan.newValue;
            console.log('[Travian Scanner] Auto-scan setting changed:', newValue);
            
            autoScanEnabled = newValue;
            
            if (autoScanEnabled) {
                startPeriodicAutoScan();
                // Быстрое сканирование при включении
                setTimeout(() => {
                    if (autoScanEnabled && !isScanning) {
                        scanPageForAttacks();
                    }
                }, 1000);
            } else {
                stopPeriodicAutoScan();
            }
        }
    });
    
    // Функция для отправки данных через background
    async function sendAutoScanData(villageData, allianceData) {
        try {
            // Проверяем автосканирование
            const result = await chrome.storage.local.get(['autoScan', 'auth_keys']);
            
            console.log('[Travian Scanner] === AUTO SCAN DATA SEND ===');
            console.log('[Travian Scanner] Auto-scan setting from storage:', result.autoScan);
            
            if (!result.autoScan) {
                console.log('[Travian Scanner] Auto-scan disabled, aborting');
                return;
            }
            
            // Получаем информацию о сервере и игроке
            const server = window.location.hostname;
            let playerName = '';
            const villageBoxes = document.getElementById('villageBoxes');
            if (villageBoxes) {
                const playerNameElement = villageBoxes.querySelector('.playerName');
                if (playerNameElement) {
                    playerName = playerNameElement.textContent.trim();
                }
            }
            
            if (!playerName) {
                console.log('[Travian Scanner] ERROR: No player name found');
                return;
            }
            
            // Проверяем ключ для этого сервера и игрока
            const authKeys = result.auth_keys || {};
            const serverKey = `${server}_${playerName}`;
            const authKey = authKeys[serverKey];
            
            if (!authKey || !authKey.key) {
                console.log('[Travian Scanner] ERROR: No auth key found');
                return;
            }
            
            console.log('[Travian Scanner] Auth key found, length:', authKey.key.length);
            
            // Отправляем данные через background
            console.log('[Travian Scanner] Sending data to background script...');
            
            let response;
            try {
                response = await chrome.runtime.sendMessage({
                    type: 'SEND_ATTACK_DATA',
                    data: {
                        villages: villageData,
                        alliance: allianceData,
                        timestamp: new Date().toISOString(),
                        server: `https://${server}/`,
                        playerName: playerName,
                        authKey: authKey.key,
                        page: window.location.href
                    }
                });
            } catch (runtimeError) {
                const errorMsg = runtimeError.message || runtimeError.toString();
                if (errorMsg.includes('Extension context invalidated') || 
                    errorMsg.includes('context invalidated')) {
                    console.warn('[Travian Scanner] Extension context invalidated, aborting send');
                    return;
                }
                // Пробрасываем другие ошибки
                throw runtimeError;
            }
            
            if (response && response.success) {
                console.log('[Travian Scanner] Auto-scan data sent successfully');
            } else if (response && response.reason === 'too_frequent') {
                console.log('[Travian Scanner] Auto-scan skipped: too frequent');
            } else if (response && response.success === false && response.error === 'Unauthorized') {
                console.log('[Travian Scanner] Auth key invalid, disabling auto-scan');
                await chrome.storage.local.set({ autoScan: false });
                autoScanEnabled = false;
                stopPeriodicAutoScan();
            } else {
                console.log('[Travian Scanner] Failed to send auto-scan data');
            }
            
        } catch (error) {
            console.error('[Travian Scanner] ERROR in sendAutoScanData:', error);
        }
    }
    
    // Парсинг данных атак из ответа API с использованием словаря из CONFIG
    function parseAttackData(apiData) {
        console.log('Parsing attack data:', apiData);
        
        let attacks = 0;
        let raids = 0;
        
        if (apiData?.text) {
            const text = apiData.text.toLowerCase();
            console.log('Text to parse:', text);
            
            // Словарь ключевых слов для парсинга из CONFIG
            const keywords = CONFIG.ATTACK_TYPE_KEYWORDS;
            
            // Ищем совпадения для каждого типа атаки
            let attackFound = false;
            let raidFound = false;
            
            // Проверяем каждое ключевое слово для атак
            for (const keyword of keywords.attack) {
                const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*(\\d+)', 'i');
                const match = text.match(regex);
                if (match) {
                    attacks = parseInt(match[1]);
                    attackFound = true;
                    console.log(`Attack found with keyword "${keyword}":`, attacks);
                    break;
                }
            }
            
            // Проверяем каждое ключевое слово для набегов
            for (const keyword of keywords.raid) {
                const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*(\\d+)', 'i');
                const match = text.match(regex);
                if (match) {
                    raids = parseInt(match[1]);
                    raidFound = true;
                    console.log(`Raid found with keyword "${keyword}":`, raids);
                    break;
                }
            }
            
            // Альтернативный формат: если не нашли по ключевым словам, ищем число
            if (!attackFound && !raidFound) {
                const totalMatch = text.match(/\d+/);
                if (totalMatch) {
                    // Определяем тип по наличию ключевых слов в тексте
                    const hasRaidKeyword = keywords.raid.some(kw => text.includes(kw));
                    const hasAttackKeyword = keywords.attack.some(kw => text.includes(kw));
                    
                    if (hasRaidKeyword) {
                        raids = parseInt(totalMatch[0]);
                    } else if (hasAttackKeyword) {
                        attacks = parseInt(totalMatch[0]);
                    } else {
                        // По умолчанию считаем атакой
                        attacks = parseInt(totalMatch[0]);
                    }
                }
            }
        }
        
        console.log('Parsed result - attacks:', attacks, 'raids:', raids);
        return { attacks, raids };
    }
    
    // Получить данные атак для деревни через API (через background script)
    async function getVillageAttack(villageId) {
        try {
            console.log(`[Travian Scanner] Requesting attack data for village ${villageId} from background...`);
            
            // Отправляем запрос в background script
            let response;
            try {
                response = await chrome.runtime.sendMessage({
                    type: 'GET_VILLAGE_ATTACK',
                    villageId: villageId,
                    url: window.location.href
                });
            } catch (runtimeError) {
                const errorMsg = runtimeError.message || runtimeError.toString();
                if (errorMsg.includes('Extension context invalidated') || 
                    errorMsg.includes('context invalidated')) {
                    console.warn('[Travian Scanner] Extension context invalidated, aborting request');
                    return null;
                }
                throw runtimeError;
            }
            
            if (response && response.success && response.data) {
                console.log(`[Travian Scanner] Received attack data for village ${villageId}:`, response.data);
                return parseAttackData(response.data);
            } else {
                console.log(`[Travian Scanner] No attack data for village ${villageId} or error:`, response?.error);
                return null;
            }
            
        } catch (error) {
            console.error(`[Travian Scanner] Error getting attack data for village ${villageId}:`, error);
            return null;
        }
    }
   
    // Получить атаки на деревни игрока
    async function getVillageAttackData() {
        const villageIds = [];
        const villageEntries = document.querySelectorAll('.villageList .listEntry.village');
        
        villageEntries.forEach((entry) => {
            const villageId = entry.dataset.did;
            if (villageId) {
                villageIds.push(villageId);
            }
        });
        
        const villageData = [];
        
        for (const villageId of villageIds) {
            console.log('Processing village:', villageId);
            const attackData = await getVillageAttack(villageId);
            console.log('Attack data for village:', villageId, attackData);
            
            if (!attackData) continue;
            
            const attacks = [];
            if (attackData.attacks > 0) {
                attacks.push({ type: 'attack', count: attackData.attacks });
            }
            if (attackData.raids > 0) {
                attacks.push({ type: 'raid', count: attackData.raids });
            }
            
            if (attacks.length > 0) {
                villageData.push({
                    name: getVillageName(villageId),
                    id: villageId,
                    attacks: attacks
                });
            }
            
            const delayMs = Math.floor(Math.random() * 31) + 20; // 20-50ms
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        
        return villageData;
    }
    
    // Получить название деревни по ID
    function getVillageName(villageId) {
        const element = document.querySelector(`[data-id="${villageId}"]`);
        if (!element) return `Village ${villageId}`;
        
        const listEntry = element.closest('.listEntry');
        const nameElement = listEntry?.querySelector('.name');
        return nameElement?.textContent.trim() || `Village ${villageId}`;
    }
    
    // Сканирование альянса
    function getAllianceAttackData() {
        const players = [];
        
        if (document.querySelectorAll(".allianceMembers").length > 0) {
            const rows = document.querySelectorAll(".allianceMembers")[0]
                .getElementsByTagName("tbody")[0]
                .getElementsByTagName("tr");
            
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
                        if (attackMatch) attackCount = parseInt(attackMatch[0]);
                    }
                    
                    if (parts[1]) {
                        const raidMatch = parts[1].match(/\d+/);
                        if (raidMatch) raidCount = parseInt(raidMatch[0]);
                    }
                }
                
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
        }
        
        return players;
    }
    
    // Сканирование страницы
    async function scanPageForAttacks() {
        const now = Date.now();
        
        if (isScanning || (now - lastScanTime < MIN_SCAN_INTERVAL)) {
            console.log('[Travian Scanner] Scan skipped (too frequent)');
            return;
        }
        
        isScanning = true;
        lastScanTime = now;
        
        console.log('[Travian Scanner] Starting auto-scan...');
        
        try {
            // Получаем данные деревень
            const villageData = await getVillageAttackData();
            
            // Получаем данные альянса
            const allianceData = getAllianceAttackData();
            
            console.log(`[Travian Scanner] Scan complete: ${villageData.length} villages, ${allianceData.length} players`);
            
            // Отправляем данные если есть что отправить
            if (villageData.length > 0 || allianceData.length > 0) {
                await sendAutoScanData(villageData, allianceData);
            } else {
                console.log('[Travian Scanner] No data to report');
            }
            
        } catch (error) {
            console.error('[Travian Scanner] Auto-scan error:', error);
        } finally {
            isScanning = false;
        }
    }
    
    // Дебаунсинг функция
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    // Основная функция запуска сканирования с дебаунсингом
    const debouncedScan = debounce(() => {
        const hasVillageData = document.querySelectorAll('.villageList .listEntry.village').length > 0;
        const hasAllianceData = document.querySelector('.allianceMembers');
        
        if (hasVillageData || hasAllianceData) {
            scanPageForAttacks();
        }
    }, 2000);
    
    // Инициализация при загрузке страницы
    async function initializeScanner() {
        // Предотвращаем множественную инициализацию
        if (isInitialized) {
            console.log('[Travian Scanner] Already initialized, skipping...');
            return;
        }
        
        console.log('[Travian Scanner] Initializing on Travian page...');
        isInitialized = true;
        
        // Загружаем настройки
        await loadAutoScanSettings();
    }
    
    // ВАЖНО: Запускаем инициализацию сразу, не дожидаясь DOMContentLoaded
    // если документ уже загружен
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeScanner);
    } else {
        // Документ уже загружен, запускаем сразу
        initializeScanner();
    }
    
    // Также запускаем при полной загрузке страницы (на всякий случай)
    window.addEventListener('load', () => {
        console.log('[Travian Scanner] Page fully loaded');
        // Если еще не инициализировано, инициализируем
        if (!isInitialized) {
            initializeScanner();
        }
    });
    
    // Мониторинг изменений на странице
    const observer = new MutationObserver((mutations) => {
        if (!autoScanEnabled) return;
        
        let shouldScan = false;
        
        for (const mutation of mutations) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1) {
                        if (node.matches && (
                            node.matches('.incomingTroops .attack') ||
                            node.matches('.allianceMembers') ||
                            node.querySelector('.incomingTroops .attack') ||
                            node.querySelector('.allianceMembers')
                        )) {
                            shouldScan = true;
                            break;
                        }
                    }
                }
            }
            if (shouldScan) break;
        }
        
        if (shouldScan) {
            console.log('[Travian Scanner] Page changed, scheduling scan...');
            debouncedScan();
        }
    });
    
    // Настраиваем observer
    if (document.body) {
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false,
            characterData: false
        });
    } else {
        // Если body еще нет, ждем
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: false,
                characterData: false
            });
        });
    }
    
    // Отслеживаем изменения URL
    let lastUrl = location.href;
    new MutationObserver(() => {
        if (!autoScanEnabled) return;
        
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            console.log('[Travian Scanner] URL changed, scheduling scan...');
            setTimeout(() => {
                if (autoScanEnabled) {
                    debouncedScan();
                }
            }, 3000);
        }
    }).observe(document, { subtree: true, childList: true });
}