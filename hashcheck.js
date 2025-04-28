const bcrypt = require('bcryptjs');

const plainTextPassword = 'Jocker@1202'; // Plain text password
const hashedPassword = '$2b$10$Rox5zDt1ktHoaRFBGZedseULGWcor2DLZXR7WGdM0uUfQWJ3r8R8e'; // Hash stored in database

bcrypt.compare(plainTextPassword, hashedPassword, (err, result) => {
    if (err) {
        console.error('Error during password comparison:', err.message);
    } else {
        console.log('Password match:', result); // Expect "true" if valid
    }
});