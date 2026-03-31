//import { CONFIG } from './config.js';
importScripts('config.js');

const MIN_AUTO_SCAN_INTERVAL = CONFIG.MIN_AUTO_SCAN_INTERVAL;
const DEBUG = CONFIG.DEBUG;

let lastAutoScanTime = 0;

//Логируем только в режиме отладки
function debugLog(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

// Фоновая служба для обработки данных сканирования
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Background] Received message type:', message.type);
	
	if (message.type === 'SEND_ATTACK_DATA') {
        console.log('addListener: Processing SEND_ATTACK_DATA');
		debugLog('addListener: Data received:', {
            villages: message.data.villages?.length,
            alliance: message.data.alliance?.length,
            server: message.data.server,
            playerName: message.data.playerName,
            hasAuthKey: !!message.data.authKey,
            authKeyLength: message.data.authKey?.length
        });
        
        const now = Date.now();
        // Проверяем интервал между автосканированиями
        if (now - lastAutoScanTime < MIN_AUTO_SCAN_INTERVAL) {
            sendResponse({ success: false, reason: 'too_frequent' });
            return true;
        }
        
        lastAutoScanTime = now;
        debugLog('addListener: Processing attack data...');
        
        // Обрабатываем данные в фоновом режиме
        sendAttackData(message.data)
            .then(() => {
                console.log('addListener Auto-scan data processed successfully');
                sendResponse({ success: true });
            })
            .catch(error => {
                console.error('addListener Error processing auto-scan data:', error);
                sendResponse({ success: false, error: error.message });
            });
            
        return true; // Сохраняем соединение для асинхронного ответа
	}
	
	if (message.type === 'GET_ACTIVE_TAB') {
        getActiveTabId().then(tabId => {
            sendResponse({ tabId });
        });
        return true; // Важно для асинхронного ответа
    }
    
	if (message.type === 'GET_VILLAGE_ATTACK') {
        // Здесь background script должен выполнить запрос к API
        // через chrome.scripting.executeScript
        handleGetVillageAttack(message, sender, sendResponse);
        return true; // Для асинхронного ответа
    }
	
    console.log('[Background] Unknown message type:', message.type);
    return true;
});

async function handleGetVillageAttack(message, sender, sendResponse) {
    try {
        // Используем chrome.scripting.executeScript в background
        const result = await chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            func: (villageId) => {
                return fetch(`${window.location.origin}/api/v1/tooltip/incomingTroops`, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json, text/javascript, */*; q=0.01',
                        'Content-Type': 'application/json; charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    body: JSON.stringify({ villageIds: [villageId] })
                }).then(res => res.json());
            },
            args: [message.villageId]
        });
        
        sendResponse({ success: true, data: result[0]?.result });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

async function getActiveTabId() {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            resolve(tabs[0]?.id);
        });
    });
}

//Отправка данных об атаках на деревни игрока или на игроков альянса
async function sendAttackData(attackData) {
	debugLog('sendAttackData: ----- begin -----');
	
	const API_URL = CONFIG.API_URL;
	
	// Проверка наличия ключа авторизации
    if (!attackData.authKey) {
        console.error('[Background] CRITICAL ERROR: No auth key! Cannot send data.');
        return;
    }
	
	// Проверка наличия данных для отправки
    if (!attackData.villages?.length && !attackData.alliance?.length) {
        debugLog('sendAttackData: No data to send');
        return;
    }
	
	// Кодируем имя игрока для заголовка
	const encodedPlayerName = btoa(encodeURIComponent(attackData.playerName));
        
	const headers = {
		'Content-Type': 'application/json',
		'X-Auth-Key': attackData.authKey,
		'X-Server': attackData.server,
		'X-Player-Name': encodedPlayerName
	};
	
	if (attackData.villages?.length > 0) {
		const villagePayload = {
			message_id: `auto_village_${Date.now()}`,
			type: 'village',
			data: attackData.villages, // Это МАССИВ - правильно для сервера
			metadata: {
				server: attackData.server,
				player: attackData.playerName,
				source: 'auto_scan',
				page: attackData.page,
				timestamp: attackData.timestamp || new Date().toISOString()
			}
		};
		
		
		try {
			debugLog(`sendAttackData: Sending ${attackData.villages.length} villages...`);
			
			const villageResponse = await fetch(`${API_URL}/api/attacks`, {
				method: 'POST',
				headers: headers,
				body: JSON.stringify(villagePayload)
			});
			
			debugLog('sendAttackData: Village response status:', villageResponse.status);
			
			if (villageResponse.ok) {
					const result = await villageResponse.json();
					debugLog('sendAttackData: Villages sent successfully:', result);
				} else {
					const errorText = await villageResponse.text();
					debugLog('sendAttackData: Error sending villages:', villageResponse.status, errorText);
					
					// Если ошибка авторизации, удаляем ключ
					if (villageResponse.status === 401) {
						debugLog('sendAttackData: Authorization error, removing key...');
						await removeAuthKey(attackData.server, attackData.playerName);
					}
				}
		} catch (error) {
			debugLog('sendAttackData: ERROR sending auto-scan data:', error);
			debugLog('sendAttackData: Error name:', error.name);
			debugLog('sendAttackData: Error message:', error.message);
			
			if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
				debugLog('sendAttackData: NETWORK ERROR: Cannot connect to server');
				debugLog('sendAttackData: Make sure the server is running at http://127.0.0.1:8000');
			}
		}
	}
	
	if (attackData.alliance?.length > 0) {
		const alliancePayload = {
                message_id: `auto_alliance_${Date.now()}`,
                type: 'alliance',
                data: attackData.alliance, 
                metadata: {
                    server: attackData.server,
                    player: attackData.playerName,
                    source: 'auto_scan',
                    page: attackData.page,
                    timestamp: attackData.timestamp || new Date().toISOString()
                }
            };
		
		try {		
			debugLog(`sendAttackData: Sending ${attackData.alliance.length} alliance members...`);
				
			const allianceResponse = await fetch(`${API_URL}/api/attacks`, {
				method: 'POST',
				headers: headers,
				body: JSON.stringify(alliancePayload)
			});
			
			debugLog('sendAttackData: Alliance response status:', allianceResponse.status);	
			
			if (allianceResponse.ok) {
					const result = await allianceResponse.json();
					debugLog('sendAttackData: Alliance sent successfully:', result);
				} else {
					const errorText = await allianceResponse.text();
					debugLog('sendAttackData: Error sending alliance:', allianceResponse.status, errorText);
				}
		} catch (error) {
			debugLog('sendAttackData: ERROR sending auto-scan data:', error);
			debugLog('sendAttackData: Error name:', error.name);
			debugLog('sendAttackData: Error message:', error.message);
			
			if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
				debugLog('sendAttackData: NETWORK ERROR: Cannot connect to server');
				debugLog('sendAttackData: Make sure the server is running at http://127.0.0.1:8000');
			}
		}
	}
	debugLog('sendAttackData: ----- end -----');
}

// Вспомогательная функция для удаления ключа авторизации
async function removeAuthKey(server, playerName) {
    try {
        const saved = await chrome.storage.local.get(['auth_keys']);
        const authKeys = saved.auth_keys || {};
        const serverKey = `${server}_${playerName}`;
        
        if (authKeys[serverKey]) {
            delete authKeys[serverKey];
            await chrome.storage.local.set({ auth_keys: authKeys });
            console.log('[Background] Auth key removed for:', serverKey);
            return true;
        }
    } catch (error) {
        console.error('[Background] Error removing auth key:', error);
        return false;
    }
}