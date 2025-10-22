const mongoose = require('mongoose');

// Define the Schema for the User collection
const UserSchema = new mongoose.Schema({    
    // Core User Data
    chatId: { 
        type: Number, 
        required: true, 
        unique: true 
    },
    firstName: { 
        type: String, 
        required: true 
    },
    username: String, 
    lastInteraction: { 
        type: Date, 
        default: Date.now 
    },
    
    // Daily Feature Tracking
    dailyLastUsed: { 
        type: Date, 
        default: new Date(0) // Start with a date far in the past
    },
    
    // Simple Game Tracking
    gameScore: { 
        type: Number, 
        default: 0 
    },
    gameGuess: Number // Stores the secret number the user needs to guess
    
    // Note: All fields must be inside this main object block
}); // <-- The schema object and function call correctly close here

// Compile the schema into a Model and export it. 
module.exports = mongoose.model('User', UserSchema);