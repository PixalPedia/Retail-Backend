const bcrypt = require('bcryptjs');

const hashPassword = async (plainPassword) => {
    try {
        // Define the number of salt rounds (higher = more secure, but slower)
        const saltRounds = 10;

        // Generate the hashed password
        const hashedPassword = await bcrypt.hash(plainPassword, saltRounds);

        console.log('Hashed Password:', hashedPassword);
        return hashedPassword;
    } catch (error) {
        console.error('Error hashing password:', error.message);
        console.error('Stack Trace:', error.stack);
        throw error;
    }
};

// Example usage
(async () => {
    const plainPassword = 'Jocker@1202';
    const hashedPassword = await hashPassword(plainPassword);
    console.log('Final Hashed Password:', hashedPassword);
    process.exit(); // Ensure the process terminates
})();
