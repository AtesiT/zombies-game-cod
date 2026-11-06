# Публикация игры и мобильная упаковка

Игра запускается как обычный статический сайт: `index.html` — входная страница, а `styles.css` и ES-модули из `src/` загружаются по относительным путям. Сборка не устанавливает npm-зависимости и не компилирует игровой код.

## Проверить статическую сборку

Из корня репозитория:

```bash
npm run build:web
python3 -m http.server 8080 --directory dist
```

Откройте `http://localhost:8080/`. Для статического хостинга загрузите **содержимое `dist/`**; его `index.html` должен оказаться в корне опубликованного сайта. Папка `dist/` генерируется заново и не коммитится.

Не открывайте исходный `index.html` двойным щелчком как `file://`: браузеры блокируют загрузку ES-модулей с локального диска. GitHub Pages и остальные статические хостинги отдают страницу по HTTP/HTTPS, поэтому сборка там работает без Node-сервера.

## GitHub Pages

В репозитории уже есть workflow `.github/workflows/pages.yml`:

1. В GitHub откройте **Settings → Pages → Build and deployment** и выберите **GitHub Actions**.
2. Workflow настроен запускаться при push в `main` **и в ветку** `arena/852e1f6a-zombies-game-cod`. После push на выбранную ветку он выполнит `npm run build:web` и опубликует `dist/`.
3. Результат и адрес сайта видны во вкладках **Actions** и **Settings → Pages**. Учтите: обе ветки публикуют на один и тот же Pages-адрес; более поздняя публикация заменит предыдущую.

Пути ресурсов относительные, поэтому работают и на адресе проекта вида `https://<user>.github.io/<repo>/`, и на других статических хостингах. Для Cloudflare Pages, Netlify или аналогов укажите команду сборки `npm run build:web` и каталог публикации `dist`.

GitHub Pages отдаёт только статические файлы. **SOLO и TEST RANGE** работают без сервера; для кооператива нужен отдельный WebSocket-ретранслятор, доступный по `wss://`. В `game-config.js` можно указать адрес такого релея:

```js
globalThis.ZOMBIES_GAME_CONFIG ??= {
  relay: 'wss://play.example.com/net',
};
```

`relay: null` оставляет автоматический выбор: локальный `server.mjs` использует текущий хост, а GitHub Pages и приложение Capacitor не пытаются подключиться к отсутствующему серверу. `relay: false` или `relay: ''` явно отключает сеть. Если меняете файл конфигурации, пересоберите сайт.

`server.mjs` предназначен для локальной игры и доверенной сети. Для разрешения запросов с Pages или Capacitor у релея можно задать точный allowlist origin-ов при запуске, например:

```bash
ZOMBIES_ALLOWED_ORIGINS="https://username.github.io,https://localhost,capacitor://localhost" node server.mjs
```

Укажите реальный origin сайта (и только нужные origin-ы); для своего домена замените адрес Pages. Это лишь проверка origin, не аутентификация: не выставляйте сервер напрямую в публичный Интернет без отдельной защиты и HTTPS/WSS reverse proxy.

## Подготовка APK и IPA через Capacitor

`capacitor.config.json` уже настроен на папку `dist/`. Когда будете готовы создавать нативные проекты, установите Capacitor и добавьте нужные платформы:

```bash
npm install @capacitor/core
npm install --save-dev @capacitor/cli
npm install @capacitor/android @capacitor/ios
npx cap add android
npx cap add ios
npm run build:web
npx cap sync
```

После изменений веб-версии повторяйте `npm run build:web` и `npx cap sync`.

- **APK / Android:** откройте проект командой `npx cap open android` в Android Studio и соберите APK. Для публикации понадобится подписанный release build и Android SDK/JDK.
- **IPA / iOS:** `npx cap open ios` открывает проект в Xcode. Сборка и подпись IPA требуют macOS, Xcode и соответствующего Apple Developer signing profile.

В `capacitor.config.json` задан идентификатор `com.atesit.zombiesgamecod`; проверьте его уникальность и зафиксируйте до первой публикации в магазинах. Если мобильное приложение должно играть по сети, укажите внешний `wss://` адрес в `game-config.js` до сборки.
