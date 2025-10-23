const User = require('../models/UserModel'); // <-- Check this path! (Assumes models/UserModel.js)

// Helper to get the start of the current day in UTC (00:00:00.000Z)
const startOfUTCToday = () => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

// Helper to get the start of the previous day in UTC
const startOfUTCYesterday = () => {
    const today = startOfUTCToday();
    return new Date(today.getTime() - (24 * 60 * 60 * 1000));
};

/**
 * Updates a user's daily streak and total score after they perform a daily action.
 * @param {number} chatId The user's Telegram chatId.
 * @param {number} scoreAward The points to award the user (for totalScore).
 * @returns {object} An object containing the result and streak status.
 */
async function updateUserStreakAndScore(chatId, scoreAward) {
    const user = await User.findOne({ chatId });

    if (!user) {
        return { success: false, reason: "User not found" };
    }

    const now = new Date();
    const todayUTC = startOfUTCToday();
    const yesterdayUTC = startOfUTCYesterday();
    
    // Check if the user has already performed the daily action today.
    if (user.lastActivityDate && user.lastActivityDate.getTime() >= todayUTC.getTime()) {
        // Same Day - OPTIONAL: Still award score to totalScore, but don't increase streak
        // We will keep the original logic for simplicity: only update totalScore for the leaderboard.
        user.totalScore += scoreAward; 
        await user.save(); 

        return { 
            success: true, 
            newStreak: user.currentStreak, 
            isNewDay: false,
            scoreAdded: scoreAward,
            message: `Already completed today. Streak remains ${user.currentStreak}.`
        };
    }

    // --- User HAS NOT completed the action today. Process streak. ---
    
    let newStreak = 1;
    let message = "First action ever! Streak started at 1.";

    if (user.lastActivityDate) {
        // Streak Continued: Check if last activity was yesterday
        if (user.lastActivityDate.getTime() >= yesterdayUTC.getTime()) {
            newStreak = user.currentStreak + 1;
            message = `🔥 *Streak continued!* Your streak is now ${newStreak} days! (Total Score: +${scoreAward})`;
        } else {
            // Streak Broken
            newStreak = 1;
            message = `😭 *Streak broken!* Resetting to 1. Your longest was ${user.longestStreak} days. (Total Score: +${scoreAward})`;
        }
    }
    // First Time: newStreak remains 1, message is already set.

    // --- Perform Database Updates ---
    user.currentStreak = newStreak;
    user.lastActivityDate = now; 
    user.totalScore += scoreAward; 
    user.gameScore += scoreAward; // Keep updating gameScore too, as per original logic

    // Update longest streak
    if (newStreak > user.longestStreak) {
        user.longestStreak = newStreak;
    }

    await user.save();
    
    return { 
        success: true, 
        newStreak: newStreak, 
        isNewDay: true, 
        scoreAdded: scoreAward,
        message: message
    };
}


/**
 * Formats the array of top users into a Markdown string for Telegram.
 * @param {Array<object>} leaderboardData Array of user documents from getLeaderboard.
 * @returns {string} The formatted Markdown message.
 */
function formatLeaderboardMessage(leaderboardData) {
    if (!leaderboardData || leaderboardData.length === 0) {
        return "The leaderboard is empty! Be the first to get a score! 🏅";
    }

    let message = "🏆 *Global Leaderboard (Top 10)* 🏆\n\n";
    // Use fixed-width code block for perfect alignment
    message += "`Rank | Username        | Total | Streak`\n";
    message += "----------------------------------------\n";

    leaderboardData.forEach((user, index) => {
        const rank = index + 1;
        
        // Emojis for top 3
        let rankDisplay = `${rank}.`;
        if (rank === 1) rankDisplay = "🥇";
        else if (rank === 2) rankDisplay = "🥈";
        else if (rank === 3) rankDisplay = "🥉";
        
        // Prepare user name (use @username if available, otherwise first name)
        const name = user.username ? `@${user.username}` : user.firstName;
        const displayName = name.substring(0, 15).padEnd(15);
        
        // Pad numbers for alignment
        const score = String(user.totalScore).padEnd(5);
        const streak = String(user.longestStreak).padEnd(6);

        // Format the line inside the code block
        message += `${rankDisplay.padEnd(4)}| ${displayName} | ${score} | ${streak}\n`;
    });

    message += "\n*Total* = Total Score | *Streak* = Longest Streak";
    
    return message;
}


/**
 * Fetches the top users for the global leaderboard.
 */
async function getLeaderboard(limit = 10) {
    try {
        const leaderboard = await User.find({})
            .sort({ 
                totalScore: -1, 
                longestStreak: -1, 
                currentStreak: -1,
            })
            .select('firstName username totalScore longestStreak currentStreak')
            .limit(limit)
            .exec();

        return leaderboard;
    } catch (error) {
        console.error("Error fetching leaderboard:", error);
        return [];
    }
}

module.exports = { 
    updateUserStreakAndScore,
    getLeaderboard,
    formatLeaderboardMessage
};