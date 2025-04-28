const express = require('express');
const router = express.Router();
const { supabase } = require('../supabaseClient'); // Adjust path as needed

// Route to list blocked IPs with details.
router.get('/blocked-ips', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('blocked_ips')
      .select('*')
      .order('created_at', { ascending: false });
      
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.status(200).json(data);
  } catch (err) {
    console.error('Error retrieving blocked IPs:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
