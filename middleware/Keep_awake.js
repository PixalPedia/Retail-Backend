setInterval(() => {
    require('http').get('https://retail-backend-k7ix.onrender.com');
    console.log("Pinged Render to stay awake!");
}, 300000); // Ping every 5 minutes (300,000 milliseconds)
