// index.js

// 1. Load variables from .env file FIRST
require('dotenv').config({ silent: true }); 

const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const User = require('./models/UserModel'); // Import the Mongoose User Model

// --- Database Connection Setup ---

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ MongoDB connected successfully.');
    } catch (err) {
        console.error('❌ MongoDB connection error:', err.message); 
        // Critical dependency failed: exit the process
        process.exit(1); 
    }
};

// --- Bot Initialization ---

const token = process.env.BOT_TOKEN; 
const bot = new Telegraf(token);

// --- Bot Features ---

// Helper function (Daily Cooldown)
function isDailyReady(lastUsed) {
    const now = new Date();
    const last = new Date(lastUsed);
    const today = now.toISOString().split('T')[0];
    const lastDay = last.toISOString().split('T')[0];
    return today !== lastDay;
}

// Dashboard function
function getDashboardMessage(firstName, gameScore) {
    // Using default Markdown (no V2 suffix) for simple, robust formatting.
    
    return `👋 *Welcome, ${firstName}!*

🤖 *Here's what I can do:*

📊 *YOUR STATUS*
   💰 Score: ${gameScore}

📅 *DAILY FEATURE*
   Claim daily rewards once per day to earn points.
   Type: **daily reward**

🎲 *GUESSING GAME*
   Compete against the bot by guessing a secret number (1-10).
   Start New Game: **play game**
   Make a Guess: **guess 5** (or any number)

⚙️ *OTHER*
   See this dashboard: **menu** or **/start**
   Echo your text: Just type anything else.

_Note: Commands are not case-sensitive._`;
}

// 1. MENU/START COMMAND 
// Listens for '/start', 'menu', or 'start' as a standalone word only (using \b anchors)
bot.hears(/\b(start|menu)\b/i, async (ctx) => {
    const { id, first_name, username } = ctx.from;
    let user;

    try {
        user = await User.findOne({ chatId: id });

        if (!user) {
            user = await User.create({
                chatId: id,
                firstName: first_name,
                username: username
            });
            console.log(`New user registered: ${first_name} (${id})`);
        } else {
            user.lastInteraction = Date.now();
            await user.save();
        }
        
        const dashboardMessage = getDashboardMessage(user.firstName, user.gameScore);
        
        ctx.reply(dashboardMessage, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error("Database interaction error on /start:", error);
        ctx.reply("I'm having trouble initializing right now. Please try again later.");
    }
});


// 2. DAILY REWARD COMMAND
// Listens for 'daily reward' (not case-sensitive)
bot.hears(/daily\s*reward/i, async (ctx) => {
    const chatId = ctx.from.id;
    const user = await User.findOne({ chatId });

    if (!user) {
        return ctx.reply("Please type 'menu' first to register!");
    }

    if (isDailyReady(user.dailyLastUsed)) {
        user.gameScore += 10; 
        user.dailyLastUsed = Date.now();
        await user.save();

        ctx.reply(`💰 *Daily Reward Claimed!* You earned 10 points. Your total score is now: ${user.gameScore}`, { parse_mode: 'Markdown' });
    } else {
        const msPerDay = 24 * 60 * 60 * 1000;
        const msSinceClaim = Date.now() - user.dailyLastUsed.getTime();
        const msRemaining = msPerDay - msSinceClaim;
        
        const hours = Math.floor(msRemaining / (1000 * 60 * 60));
        const minutes = Math.floor((msRemaining % (1000 * 60 * 60)) / (1000 * 60));

        ctx.reply(`⏳ You've already claimed your reward today. Try again in ${hours}h ${minutes}m.`);
    }
});

// 3. NEW GAME COMMAND
// Listens for 'play game' (not case-sensitive)
bot.hears(/play\s*game/i, async (ctx) => { // <-- LISTENS FOR 'play game'
    const chatId = ctx.from.id;
    const user = await User.findOne({ chatId });

    if (!user) {
        return ctx.reply("Please type 'menu' first to register!");
    }

    const secretNumber = Math.floor(Math.random() * 10) + 1;
    user.gameGuess = secretNumber;
    await user.save();

    ctx.reply("🎲 *NEW GAME STARTED!* I'm thinking of a number between 1 and 10. Send your guess by typing 'guess [number]' (e.g., guess 5)", { parse_mode: 'Markdown' });
});

// 4. GUESS COMMAND
// Listens for 'guess ' followed by a number (e.g., 'guess 5')
bot.hears(/guess\s+(\d+)/i, async (ctx) => {
    const chatId = ctx.from.id;
    const user = await User.findOne({ chatId });

    if (!user || user.gameGuess === undefined || user.gameGuess === null) {
        return ctx.reply("Please start a new game first by typing 'start game'.");
    }

    // Use the regex capture group (ctx.match[1]) for the number
    const userGuess = parseInt(ctx.match[1], 10);
    const secretNumber = user.gameGuess;

    if (userGuess < 1 || userGuess > 10) {
        return ctx.reply("That's not a valid number! Please guess a number between 1 and 10.");
    }

    if (userGuess === secretNumber) {
        user.gameScore += 5; 
        user.gameGuess = null; 
        await user.save();

        ctx.reply(`🎉 *CORRECT!* The number was ${secretNumber}. You earned 5 points! Total score: ${user.gameScore}`, { parse_mode: 'Markdown' });
    } else if (userGuess < secretNumber) {
        ctx.reply("❌ Too low! Try a higher number.");
    } else {
        ctx.reply("❌ Too high! Try a lower number.");
    }
});

// index.js (Replace the existing bot.on('text', ...) handler with this one)

// 5. Echo/Fallback functionality 
// This should be the LAST handler. It handles messages that weren't caught by a specific keyword.
bot.on('text', (ctx) => {
    const text = ctx.message.text.toLowerCase();
    
    // Check if the text matches any of the keyword patterns 
    // that might be caught before this handler (or if it's an unrecognized command).
    if (text.startsWith('/') || text.match(/daily\s*reward|play\s*game|guess\s+\d+|start|menu/i)) {
        // If it looks like a command/keyword, but wasn't handled (e.g., /help), guide them.
        return ctx.reply("I don't recognize that command. Type **menu** to see what I can do!", { parse_mode: 'Markdown' });
    }
    
    // If the user sends a simple, unrelated message (like "Hi" or "I'm new"),
    // send a friendly, actionable response instead of just echoing.
    if (ctx.message.text.length < 10) { // Simple heuristic for a short greeting
        return ctx.reply("Thanks for reaching out! To get started and see all my features, just type **menu**.", { parse_mode: 'Markdown' });
    }

    // Default echo for longer, unrecognized chat
    ctx.reply(`🤖 Echo: ${ctx.message.text}`);
});

// --- Main Execution ---

connectDB(); 
bot.launch();

console.log('Node.js Telegram Bot is running...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));