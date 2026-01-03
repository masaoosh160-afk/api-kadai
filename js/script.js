// OpenWeatherMap APIキーとGemini APIキーを読み込む
import { WEATHER_API_KEY, GEMINI_API_KEY } from './config.js';

let map;
let userPosMarker = null;
let facilityLayer; // 施設アイコンを管理する専用レイヤー

document.addEventListener('DOMContentLoaded', initApp);

function initApp() {
    // 地図の初期化（東京駅付近をデフォルトに）
    map = L.map('map').setView([35.6812, 139.7671], 15);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    // 施設アイコン用のレイヤーを地図の上に乗せる
    facilityLayer = L.layerGroup().addTo(map);

    // イベント登録
    document.getElementById('dest-search-btn').addEventListener('click', searchDestination);
    document.getElementById('search-around-btn').addEventListener('click', () => {
        const center = map.getCenter();
        fetchFacilities(center.lat, center.lng);
    });
    document.getElementById('current-location-btn').addEventListener('click', handleCurrentLocation);

    // 初回実行
    updateUserMarker(35.6812, 139.7671, "東京駅 (サンプル)");
    fetchFacilities(35.6812, 139.7671);
    getWeatherAndAI(35.6812, 139.7671);
}

// 自分の位置ピンを更新
function updateUserMarker(lat, lon, label) {
    if (userPosMarker) map.removeLayer(userPosMarker);
    const icon = L.divIcon({
        html: '🚶',
        className: 'baby-marker user-marker',
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });
    userPosMarker = L.marker([lat, lon], { icon: icon, zIndexOffset: 2000 }).addTo(map)
        .bindPopup(label).openPopup();
}

// 目的地検索
async function searchDestination() {
    const query = document.getElementById('destination-input').value;
    if (!query) return;

    document.getElementById('ai-advice-text').innerText = "新しい目的地を分析中...";

    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
        const data = await res.json();
        if (data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lon = parseFloat(data[0].lon);
            map.setView([lat, lon], 16);
            
            updateUserMarker(lat, lon, `目的地: ${query}`);
            await getWeatherAndAI(lat, lon); // AIを先に更新
            await fetchFacilities(lat, lon); // 次に施設
        } else {
            alert("場所が見つかりませんでした");
        }
    } catch (e) {
        console.error(e);
    }
}

// 施設検索 (ヒット率強化版)
async function fetchFacilities(lat, lon) {
    facilityLayer.clearLayers(); // 古いアイコンを全削除

    const query = `[out:json][timeout:30];
        (
          node["amenity"~"baby_feeding|diaper_change"](around:2500,${lat},${lon});
          node["changing_table"="yes"](around:2500,${lat},${lon});
          node["amenity"="toilets"]["wheelchair"="yes"](around:2500,${lat},${lon});
          way["amenity"~"baby_feeding|diaper_change"](around:2500,${lat},${lon});
          way["changing_table"="yes"](around:2500,${lat},${lon});
          way["amenity"="toilets"]["wheelchair"="yes"](around:2500,${lat},${lon});
        );
        out center;`;
    
    const url = "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query);

    try {
        const res = await fetch(url);
        const data = await res.json();
        
        data.elements.forEach(el => {
            const pos = el.lat ? [el.lat, el.lon] : [el.center.lat, el.center.lon];
            const tags = el.tags || {};
            const dist = Math.round(map.distance([lat, lon], pos));
            const time = Math.ceil(dist / 80);

            let emoji = (tags.amenity === 'baby_feeding') ? "🍼" : "🚽";

            const icon = L.divIcon({
                html: emoji, className: 'baby-marker', iconSize: [40, 40], iconAnchor: [20, 20]
            });

            const m = L.marker(pos, { icon: icon, zIndexOffset: 1000 });
            m.bindPopup(`
                <div style="text-align:center">
                    <b>${emoji} ${tags.name || "赤ちゃん休憩室"}</b><br>
                    📏 距離: 約${dist}m (徒歩${time}分)<br>
                    <hr style="border:0;border-top:1px solid #eee;margin:5px 0">
                    <a href="https://www.google.com/maps/dir/?api=1&destination=${pos[0]},${pos[1]}" target="_blank" style="color:#ff4081;font-weight:bold;text-decoration:none">▶ここへ行く</a>
                </div>
            `);
            facilityLayer.addLayer(m);
        });
    } catch (e) {
        console.error("施設検索エラー:", e);
    }
}

// 天気とAIアドバイス (レパートリー強化版)
async function getWeatherAndAI(lat, lon) {
    const adviceEl = document.getElementById('ai-advice-text');
    
    try {
        const wRes = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&lang=ja&appid=${WEATHER_API_KEY}`);
        const wData = await wRes.json();
        const temp = Math.round(wData.main.temp);
        const desc = wData.weather[0].description;
        const hum = wData.main.humidity;

        document.getElementById('weather-info').innerText = `🌡 ${temp}℃ / ${desc} (湿度${hum}%)`;

        const prompt = `あなたは育児経験豊富なアドバイザーです。
        場所の状況：気温${temp}度、天気は${desc}、湿度は${hum}%。
        ベビーカーで娘と外出中のパパへ、今の状況にぴったりの「持ち物」「娘の服装」「パパへのねぎらい」のいずれかを、30文字以内で親しみやすく教えて。
        「水分補給」という言葉は使わずに、毎回違う視点でアドバイスしてください。`;

        const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        
        const gData = await gRes.json();
        adviceEl.innerText = gData.candidates[0].content.parts[0].text;

    } catch (e) {
        const fallbacks = ["娘さんの靴下、脱げてないか見てあげてね。", "パパ、たまには深呼吸してリラックス！", "目的地まであと少し。娘さんと楽しんで！"];
        adviceEl.innerText = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
}

// 現在地取得
function handleCurrentLocation() {
    navigator.geolocation.getCurrentPosition(async pos => {
        const { latitude: lat, longitude: lon } = pos.coords;
        map.setView([lat, lon], 16);
        updateUserMarker(lat, lon, "現在地");
        await getWeatherAndAI(lat, lon);
        await fetchFacilities(lat, lon);
    }, () => alert("位置情報を許可してください"));
}