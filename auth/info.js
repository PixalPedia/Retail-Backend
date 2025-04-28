const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config(); // Load environment variables from .env

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

const router = express.Router();

// Fetch Detailed User Information
router.post('/get/detailed/info', async (req, res) => {
    const { user_id } = req.body; // Extract user_id from the request body
  
    try {
      if (!user_id) {
        return res.status(400).json({ error: 'User ID is required in the request body.' });
      }
  
      // Fetch user information from the 'users' table
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', user_id)
        .single();
      if (userError || !userData) {
        console.error('Error fetching user data:', userError?.message || 'User not found.');
        return res.status(404).json({ error: 'User not found in users table.' });
      }
  
      // Fetch user additional info from the 'info' table
      const { data: userInfoData, error: userInfoError } = await supabase
        .from('info')
        .select(
          'phone_number, address_line_1, address_line_2, city, apartment_or_home, state, country, postal_code'
        )
        .eq('user_id', user_id)
        .single();
      if (userInfoError) {
        console.error('Error fetching user info from info table:', userInfoError.message);
      }
  
      // Fetch reviews written by the user from the 'reviews' table
      const { data: reviewsData, error: reviewsError } = await supabase
        .from('reviews')
        .select('*')
        .eq('user_id', user_id);
      if (reviewsError) {
        console.error('Error fetching reviews:', reviewsError.message);
      }
  
      // Fetch replies written by the user from the 'replies' table
      const { data: repliesData, error: repliesError } = await supabase
        .from('replies')
        .select('*')
        .eq('user_id', user_id);
      if (repliesError) {
        console.error('Error fetching replies:', repliesError.message);
      }
  
      // Fetch orders made by the user from the 'orders' table
      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select('id') // Only fetch 'id' for use in the next query
        .eq('user_id', user_id);
      if (ordersError) {
        console.error('Error fetching orders:', ordersError.message);
      }
  
      // Extract order IDs from ordersData
      const orderIds = ordersData ? ordersData.map((order) => order.id) : [];
  
      // Fetch messages related to the user's orders via the 'order_messages' junction table
      const { data: orderMessagesData, error: orderMessagesError } = await supabase
        .from('order_messages')
        .select('message_id') // Fetch the IDs of the linked messages
        .in('order_id', orderIds); // Use order IDs to filter
      if (orderMessagesError) {
        console.error('Error fetching order-messages links:', orderMessagesError.message);
      }
  
      const messageIds = orderMessagesData ? orderMessagesData.map((link) => link.message_id) : [];
  
      // Fetch the actual messages using the message IDs
      const { data: messagesData, error: messagesError } = await supabase
        .from('messages')
        .select('*') // Fetch full details of the messages
        .in('id', messageIds); // Filter by message IDs
      if (messagesError) {
        console.error('Error fetching messages:', messagesError.message);
      }
  
      // Combine all fetched data into a single response
      const response = {
        user: userData, // Data from the 'users' table
        user_info: userInfoData || {}, // Data from the 'info' table
        reviews: reviewsData || [], // Reviews by the user
        replies: repliesData || [], // Replies by the user
        messages: messagesData || [], // Messages related to the user's orders
        orders: ordersData || [], // Orders placed by the user
      };
  
      // Return the combined data
      res.status(200).json(response);
    } catch (err) {
      console.error('Unexpected error fetching detailed user info:', err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });  

// Add or Update User Information
router.post('/add/update', async (req, res) => {
    const {
        user_id,
        phone_number,
        address_line_1,
        address_line_2,
        city,
        apartment_or_home,
        state,
        country,
        postal_code
    } = req.body;

    try {
        // Validate User ID
        if (!user_id) {
            return res.status(400).json({ error: 'User ID is required.' });
        }

        // Check if Info Already Exists for the User
        const { data: existingInfo, error: fetchError } = await supabase
            .from('info')
            .select('*')
            .eq('user_id', user_id)
            .single();

        if (fetchError && fetchError.code !== 'PGRST116') {
            // If the error is NOT "No rows found"
            console.error('Error fetching user info:', fetchError.message);
            return res.status(500).json({ error: 'Failed to fetch user information.' });
        }

        if (existingInfo) {
            // Update Existing Info
            const { error: updateError } = await supabase
                .from('info')
                .update({
                    phone_number,
                    address_line_1,
                    address_line_2,
                    city,
                    apartment_or_home,
                    state,
                    country,
                    postal_code,
                    updated_at: new Date().toISOString() // Update timestamp
                })
                .eq('user_id', user_id);

            if (updateError) {
                console.error('Error updating user info:', updateError.message);
                return res.status(500).json({ error: 'Failed to update user information.' });
            }

            return res.status(200).json({ message: 'User information updated successfully.' });
        } else {
            // Insert New Info
            const { error: insertError } = await supabase
                .from('info')
                .insert([{
                    user_id,
                    phone_number,
                    address_line_1,
                    address_line_2,
                    city,
                    apartment_or_home,
                    state,
                    country,
                    postal_code
                }]);

            if (insertError) {
                console.error('Error adding user info:', insertError.message);
                return res.status(500).json({ error: 'Failed to add user information.' });
            }

            return res.status(201).json({ message: 'User information added successfully.' });
        }
    } catch (err) {
        console.error('Unexpected Error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Fetch User Information
router.post('/fetch', async (req, res) => {
    const { user_id, username } = req.body;
  
    try {
      // Ensure that either user_id or username is provided.
      if (!user_id && !username) {
        return res.status(400).json({ error: 'Either User ID or Username is required.' });
      }
  
      let effectiveUserId = user_id;
  
      // If user_id isn't provided, but username is, then look up the user_id.
      if (!effectiveUserId && username) {
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('id')
          .eq('username', username)
          .single();
  
        if (userError || !userData) {
          console.error('Error fetching user by username:', userError ? userError.message : 'No user found');
          return res.status(404).json({ error: 'User not found.' });
        }
        effectiveUserId = userData.id;
      }
  
      // Fetch User Info from "info" table based on the effective user_id
      const { data: userInfo, error } = await supabase
        .from('info')
        .select('phone_number, address_line_1, address_line_2, city, apartment_or_home, state, country, postal_code')
        .eq('user_id', effectiveUserId)
        .single();
  
      if (error) {
        console.error('Error fetching user info:', error.message);
        return res.status(404).json({ error: 'User information not found.' });
      }
  
      res.status(200).json({
        message: 'User information fetched successfully.',
        user_info: userInfo
      });
    } catch (err) {
      console.error('Unexpected Error:', err.message);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });  

// Check if a Username Exists
router.post('/check-username', async (req, res) => {
    const { username } = req.body;
  
    try {
      if (!username) {
        return res.status(400).json({ error: 'Username is required.' });
      }
  
      // Validate length: must be between 3 and 20 characters.
      if (username.length < 3 || username.length > 20) {
        return res
          .status(400)
          .json({ error: 'Username must be between 3 and 20 characters long.' });
      }
  
      // Validate characters: only letters and numbers allowed (no spaces, special characters, or emojis).
      if (!/^[A-Za-z0-9]+$/.test(username)) {
        return res.status(400).json({
          error:
            'Username can only contain letters and numbers without spaces or special characters.',
        });
      }
  
      // Check if the username already exists in the database.
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id') // Only check for existence
        .eq('username', username)
        .single();
  
      if (userError && userError.code === 'PGRST116') {
        // "No rows found" - username is available
        return res.status(200).json({ isAvailable: true });
      }
  
      if (userError) {
        // Other errors
        console.error('Error checking username:', userError.message);
        return res
          .status(500)
          .json({ error: 'Failed to check username availability.' });
      }
  
      // Username exists
      return res.status(200).json({ isAvailable: false });
    } catch (err) {
      console.error('Unexpected Error:', err.message);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });  

module.exports = router;
