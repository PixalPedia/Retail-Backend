const express = require('express');
const { supabase } = require('../supabaseClient');
const router = express.Router();

// Helper Function: Check Superuser
const isSuperUser = async (user_id) => {
    try {
        const { data: superuser, error } = await supabase
            .from('superusers')
            .select('*')
            .eq('id', user_id)
            .single();

        if (error) {
            console.error('Superuser Check Error:', error.message);
            return false;
        }

        return superuser !== null;
    } catch (err) {
        console.error('Unexpected Error in Superuser Check:', err.message);
        return false;
    }
};

// Add Combo
router.post('/add', async (req, res) => {
    const { product_id, options, combo_price, user_id } = req.body;

    try {
        // Validate Inputs
        if (!user_id || !product_id || !Array.isArray(options) || combo_price === undefined) {
            return res.status(400).json({ error: 'All fields are required: user_id, product_id, options, combo_price.' });
        }

        // Check if User is Superuser
        const isSuper = await isSuperUser(user_id);
        if (!isSuper) {
            return res.status(403).json({ error: 'Only superusers can add combos.' });
        }

        // Convert JavaScript array to PostgreSQL array literal
        const optionsArray = `{${options.join(',')}}`;

        // Check if Combo Already Exists
        const { data: existingCombo, error: existingError } = await supabase
            .from('types_combo')
            .select('*')
            .eq('product_id', product_id)
            .eq('options', optionsArray);

        if (existingError) {
            console.error('Error Checking Existing Combo:', existingError.message);
            return res.status(500).json({ error: 'Failed to check existing combos.' });
        }

        if (existingCombo.length > 0) {
            return res.status(400).json({ error: 'Combo with the specified product ID and options already exists.' });
        }

        // Insert New Combo
        const { data, error } = await supabase
            .from('types_combo')
            .insert([{ product_id, options, combo_price }])
            .select();

        if (error) {
            console.error('Insert Error:', error.message);
            return res.status(500).json({ error: 'Failed to add combo.' });
        }

        res.status(201).json({
            message: 'Combo added successfully!',
            combo: data[0],
        });
    } catch (err) {
        console.error('Unexpected Error in Add Combo:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Edit Combo
router.patch('/edit', async (req, res) => {
    const { combo_id, product_id, options, combo_price, user_id } = req.body;

    try {
        // Validate Inputs
        if (!combo_id || isNaN(combo_id)) {
            return res.status(400).json({ error: 'Valid combo ID is required.' });
        }
        if (!product_id || !Array.isArray(options) || combo_price === undefined) {
            return res.status(400).json({ error: 'All fields are required: product_id, options, combo_price.' });
        }
        if (!user_id) {
            return res.status(400).json({ error: 'User ID is required.' });
        }

        // Superuser Check
        const isSuper = await isSuperUser(user_id);
        if (!isSuper) {
            return res.status(403).json({ error: 'Only superusers can edit combos.' });
        }

        // Update Combo
        const { data, error } = await supabase
            .from('types_combo')
            .update({ product_id, options, combo_price })
            .eq('id', parseInt(combo_id))
            .select();

        if (error) {
            console.error('Error updating combo:', error.message);
            return res.status(500).json({ error: 'Failed to update combo.' });
        }

        res.status(200).json({
            message: 'Combo updated successfully!',
            combo: data[0],
        });
    } catch (err) {
        console.error('Unexpected Error in Edit Combo:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});


// Delete Combo
router.delete('/delete', async (req, res) => {
    const { combo_id, user_id } = req.body;

    try {
        if (!user_id || !combo_id || isNaN(combo_id)) {
            return res.status(400).json({ error: 'User ID and valid combo ID are required.' });
        }

        const isSuper = await isSuperUser(user_id);
        if (!isSuper) {
            return res.status(403).json({ error: 'Only superusers can delete combos.' });
        }

        const { error } = await supabase
            .from('types_combo')
            .delete()
            .eq('id', parseInt(combo_id));

        if (error) {
            console.error('Error Deleting Combo:', error.message);
            return res.status(500).json({ error: 'Failed to delete combo.' });
        }

        res.status(200).json({ message: `Combo with ID ${combo_id} successfully deleted.` });
    } catch (err) {
        console.error('Error in Delete Combo:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Fetch Combos by Product ID
router.get('/fetch/by-product/:product_id', async (req, res) => {
    const { product_id } = req.params;

    try {
        if (!product_id) {
            return res.status(400).json({ error: 'Product ID is required.' });
        }

        const { data, error } = await supabase
            .from('types_combo')
            .select('*')
            .eq('product_id', product_id)
            .order('combo_price', { ascending: true });

        if (error) {
            console.error('Error Fetching Combos:', error.message);
            return res.status(500).json({ error: 'Failed to fetch combos.' });
        }

        res.status(200).json({
            message: `Combos fetched successfully for product ID: ${product_id}`,
            combos: data,
        });
    } catch (err) {
        console.error('Error in Fetch Combos:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Fetch All Combos
router.get('/fetch/all', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('types_combo')
            .select('*')
            .order('combo_price', { ascending: true });

        if (error) {
            console.error('Error Fetching All Combos:', error.message);
            return res.status(500).json({ error: 'Failed to fetch all combos.' });
        }

        res.status(200).json({
            message: 'All combos fetched successfully!',
            combos: data,
        });
    } catch (err) {
        console.error('Error in Fetch All Combos:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Fetch Combo Price by Options and Product ID
router.post('/fetch/price', async (req, res) => {
    const { product_id, options } = req.body;

    try {
        if (!product_id || !Array.isArray(options)) {
            return res.status(400).json({ error: 'Product ID and options are required.' });
        }

        // Convert JavaScript array to PostgreSQL array literal
        const optionsArray = `{${options.join(',')}}`;

        const { data, error } = await supabase
            .from('types_combo')
            .select('combo_price')
            .eq('product_id', product_id)
            .eq('options', optionsArray);

        if (error || data.length === 0) {
            console.error('Error Fetching Combo Price:', error?.message || 'Combo not found.');
            return res.status(404).json({ error: 'Price not found for the specified combo.' });
        }

        res.status(200).json({
            message: 'Combo price fetched successfully!',
            combo_price: data[0]?.combo_price,
        });
    } catch (err) {
        console.error('Error in Fetch Combo Price:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});


module.exports = router;
