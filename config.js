const CONFIG = {
  //API_URL: 'http://94.131.105.41',
  API_URL: 'http://127.0.0.1:8000',
  DEBUG: true, // Включаем отладочное логирование
  MIN_AUTO_SCAN_INTERVAL: 2000, // 2 секунды между автосканированиями
  
  // === API ENDPOINTS локального сервера ===
  // Авторизация — запрос API-ключа
  AUTH_API_URL: '/game/api/auth/key',
  // Атаки — отправка данных об атаках на деревни и альянс
  ATTACKS_API_URL: '/game/api/attacks',
  // Пункт сбора — отправка данных из rally point
  RALLY_API_URL: '/game/api/rally-point',
  // Верификация — подтверждение кода активации
  VERIFY_API_URL: '/game/browser/verify',
  // Статус сервера — проверка статуса верификации игрока
  SERVER_STATUS_URL: '/game/servers/status',
  
  // Словарь для парсинга типов атак из текста API
  // Ключи: 'attack' и 'raid'
  // Значения: массив вариантов написания (в нижнем регистре) для поиска в тексте
  ATTACK_TYPE_KEYWORDS: {
    attack: ['attack', 'attacks', 'атака', 'атаки', 'атак'],
    raid: ['raid', 'raids', 'набег', 'набеги', 'набегов']
  }
};