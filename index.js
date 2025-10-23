// index.js

// 1. Load variables from .env file FIRST

require('dotenv').config({ silent: true }); 
console.log('MONGO_URI is:', process.env.MONGO_URI); // Should print the full string, not 'undefined'

const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const User = require('./models/UserModel'); // Import the Mongoose User Model
const { 
    updateUserStreakAndScore, 
    getLeaderboard, 
    formatLeaderboardMessage 
} = require('./db/streakLogic'); // Import the new logic functions


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

// NOTE: The old isDailyReady helper function has been REMOVED as its logic is now 
// integrated into updateUserStreakAndScore in db/streakLogic.js.

// Dashboard function
function getDashboardMessage(firstName, gameScore, currentStreak, longestStreak, totalScore) {
    // Using default Markdown (no V2 suffix) for simple, robust formatting.
    
    return `👋 *Welcome, ${firstName}!*

📊 *YOUR STATUS*
   💰 Score: ${gameScore}
   🏅 *Total Points (Leaderboard):* ${totalScore}
   🔥 *Current Streak:* ${currentStreak} days
   🌟 *Longest Streak:* ${longestStreak} days

📅 *DAILY FEATURE*
   Claim daily rewards once per day to earn points.
   Type: **daily reward**

🎲 *GUESSING GAME*
   Compete against the bot by guessing a secret number (1-10).
   Start New Game: **play game**
   Make a Guess: **guess 5** (or any number)
   
🏆 *LEADERBOARD*
   See top users based on Total Points.
   Type: **leaderboard**

⚙️ *OTHER*
   See this dashboard: **menu** or **/start**

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
            // NOTE: Consider updating 'username' here too, in case they changed it
            user.lastInteraction = Date.now();
            await user.save();
        }
        
       
        // Assume 'user' is the Mongoose document found or created
    const dashboardMessage = getDashboardMessage(
        user.firstName, 
        user.gameScore, 
        user.currentStreak, 
        user.longestStreak,
        user.totalScore // <-- Pass the new fields
    );
    
    ctx.reply(dashboardMessage, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error("Database interaction error on /start:", error);
        ctx.reply("I'm having trouble initializing right now. Please try again later.");
    }
});


// 2. DAILY REWARD COMMAND
bot.hears(/daily\s*reward/i, async (ctx) => {
    const chatId = ctx.from.id;
    const user = await User.findOne({ chatId });

    if (!user) {
        return ctx.reply("Please type 'menu' first to register!");
    }
    
    const POINTS_AWARDED = 10;
    
    // Use the new streak function for all updates (streak, totalScore, gameScore)
    const result = await updateUserStreakAndScore(chatId, POINTS_AWARDED);

    if (result.isNewDay) {
        // Store the time of claim in the old field for this specific command's cooldown
        // NOTE: This will manage the 24-hour display and also acts as the first daily action
        user.dailyLastUsed = Date.now(); 
        await user.save();
        
        // Use the message from the streak logic
        ctx.reply(`💰 *Daily Reward Claimed!* \n${result.message}`, { parse_mode: 'Markdown' });
    } else {
        // Cooldown message when not a new day action
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
    
    // FIX: Re-add the validation for the 1-10 range
    if (userGuess < 1 || userGuess > 10) {
        return ctx.reply("That's not a valid number! Please guess a number between 1 and 10.");
    }
    // END FIX

    if (userGuess === secretNumber) {
        const POINTS_AWARDED = 5; 
        
        // This function updates currentStreak, longestStreak, totalScore, AND gameScore
        const result = await updateUserStreakAndScore(chatId, POINTS_AWARDED);
        
        user.gameGuess = null; // Clear the guess after a win
        // Note: No need to call user.save() here as it is handled inside updateUserStreakAndScore
        
        ctx.reply(`🎉 *CORRECT!* The number was ${secretNumber}. You earned ${POINTS_AWARDED} points! 
        
        ${result.message}`, { parse_mode: 'Markdown' });
        
    } else if (userGuess < secretNumber) {
        ctx.reply("❌ Too low! Try a higher number.");
    } else {
        ctx.reply("❌ Too high! Try a lower number.");
    }
});

// 5. LEADERBOARD COMMAND
// Listens for '/leaderboard' or 'leaderboard'
bot.hears(/\b(leaderboard|\/leaderboard)\b/i, async (ctx) => {
    const chatId = ctx.from.id;
    
    try {
        const topUsers = await getLeaderboard(10); // Fetch the top 10
        const message = formatLeaderboardMessage(topUsers); // Format the results
        
        // Send the formatted message using Markdown
        ctx.reply(message, { parse_mode: 'Markdown' });
        
    } catch (error) {
        console.error("Error fetching or sending leaderboard:", error);
        ctx.reply("I'm sorry, I couldn't load the leaderboard right now.");
    }
});

// 6. ADMIN RESET COMMAND <-- PASTE IT HERE
const ADMIN_ID = 7122326940; 

// Protected Admin Command
bot.hears(/\/reset/, async (ctx) => {
    const senderId = ctx.from.id;
    if (senderId !== ADMIN_ID) {
        return ctx.reply("Permission denied.");
    }
    
    // Assumes the command is like: /reset 987654321
    const targetChatId = parseInt(ctx.message.text.split(' ')[1]);

    if (!targetChatId) {
        return ctx.reply("Usage: /reset [target_chat_id]");
    }

    try {
        const result = await User.updateOne( // Use 'const result' to check if a document was modified
            { chatId: targetChatId },
            { 
                $set: { 
                    gameScore: 0, 
                    totalScore: 0, 
                    currentStreak: 0, 
                    longestStreak: 0, 
                    lastActivityDate: null,
                    dailyLastUsed: new Date(0)
                } 
            }
        );
        
        if (result.modifiedCount > 0) {
            ctx.reply(`✅ User ${targetChatId} data has been reset to zero.`);
        } else {
             ctx.reply(`⚠️ User ${targetChatId} not found or no changes were necessary.`);
        }

    } catch (error) {
        console.error("Reset error:", error);
        ctx.reply(`❌ Failed to reset user ${targetChatId}.`);
    }
});

// 7. Echo/Fallback functionality 
// This should be the LAST handler. It handles messages that weren't caught by a specific keyword.
bot.on('text', (ctx) => {
    const text = ctx.message.text.toLowerCase();
    
    // Check if the text matches any of the keyword patterns 
    // that might be caught before this handler (or if it's an unrecognized command).
    if (text.startsWith('/') || text.match(/daily\s*reward|play\s*game|guess\s+\d+|start|menu|leaderboard/i)) { // Added leaderboard to the check
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