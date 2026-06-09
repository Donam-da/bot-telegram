const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const express = require('express');

// --- TẠO WEB SERVER ẢO ĐỂ GIỮ BOT SỐNG TRÊN CLOUD ---
const app = express();
app.get('/', (req, res) => res.send('Bot is running 24/7!'));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Web server đang chạy trên port ${port}`));

// --- CẤU HÌNH ---
const BOT_TOKEN = process.env.BOT_TOKEN; // Lấy token an toàn từ cấu hình của Render
const MAX_ITERATIONS = 10;

// Khởi tạo bot với chế độ polling (liên tục quét tin nhắn mới)
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Xử lý lệnh /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Xin chào! Hãy gửi cho tôi 1 link dạng https://uptolink.vip/xxxx \nTôi sẽ tự động ấn nhiều lần và thống kê các mã đích cho bạn.");
});

// Lắng nghe tất cả các tin nhắn văn bản
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';

    // Bỏ qua nếu tin nhắn là một lệnh (bắt đầu bằng dấu '/')
    if (text.startsWith('/')) return;

    // Kiểm tra định dạng link cơ bản
    if (!text.startsWith('http')) {
        return bot.sendMessage(chatId, "Vui lòng gửi một đường link hợp lệ (bắt đầu bằng http hoặc https).");
    }

    console.log(`\n[+] Có người dùng vừa gửi link: ${text}`);

    bot.sendMessage(chatId, `⏳ Đang thực hiện ${MAX_ITERATIONS} vòng lặp truy cập link...\nQuá trình này có thể mất một lúc.`);

    const uniqueIds = new Set();
    const originalId = new URL(text).pathname.split('/').filter(p => p !== '')[0];

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new', // Sử dụng chế độ headless mới, khó bị phát hiện hơn
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Giúp Puppeteer không bị crash trên server ít RAM
                // '--single-process', // Cân nhắc loại bỏ nếu server đủ tài nguyên, vì nó có thể bị phát hiện
                '--disable-blink-features=AutomationControlled' // Tắt cờ tự động hóa để tránh bị Cloudflare/FingerprintJS chặn
            ]
        });

        for (let i = 0; i < MAX_ITERATIONS; i++) {
            console.log(`-> Đang chạy vòng lặp ${i + 1}/${MAX_ITERATIONS}...`);
            let page; // Khai báo page ở đây để có thể đóng trong khối finally
            try {
                page = await browser.newPage();

                // Đặt viewport giống người dùng thật
                await page.setViewport({ width: 1920, height: 1080 });

                // Plugin "puppeteer-extra-plugin-stealth" đã tự động xử lý User-Agent, navigator.webdriver
                // và nhiều kỹ thuật ẩn mình khác. Bạn không cần các dòng code dưới đây nữa.
                // await page.setUserAgent('...');
                // await page.evaluateOnNewDocument(() => { ... });

                // Truy cập trang nhanh hơn, không cần chờ toàn bộ ảnh/quảng cáo tải xong
                await page.goto(text, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // Đợi 5 giây để Cloudflare hoặc JS của web có đủ thời gian tự động chuyển hướng trang
                await page.waitForTimeout(5000);

                // Lấy đường link cuối cùng trình duyệt đang đứng lại
                const finalUrl = new URL(page.url());
                const pathParts = finalUrl.pathname.split('/').filter(p => p !== '');

                if (pathParts.length > 0 && pathParts[0] !== originalId) {
                    uniqueIds.add(pathParts[0]);
                    console.log(`   => Đã bắt được mã ẩn: ${pathParts[0]}`);
                }
            } catch (error) {
                console.error(`Lỗi ở vòng lặp thứ ${i + 1}:`, error.message);
            } finally {
                if (page && !page.isClosed()) {
                    await page.close();
                }
            }
        }
        await browser.close();
    } catch (error) {
        console.error("Lỗi khi chạy trình duyệt ngầm:", error);
        return bot.sendMessage(chatId, "❌ Không thể khởi tạo trình duyệt Chrome ngầm.");
    }

    // Tổng hợp và trả kết quả cho người dùng
    const count = uniqueIds.size;
    if (count > 0) {
        const idsList = Array.from(uniqueIds).map(id => `👉 \`${id}\``).join('\n');
        bot.sendMessage(chatId, `✅ Đã quét xong ${MAX_ITERATIONS} vòng lặp!\n\nTìm thấy *${count}* mã khác nhau:\n${idsList}`, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(chatId, "❌ Không tìm thấy mã nào hoặc link đích đã chặn truy cập.");
    }
});

console.log("Bot đang chạy... Bấm Ctrl+C để dừng.");