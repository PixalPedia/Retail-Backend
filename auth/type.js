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

// Fetch All Options
router.get('/options', async (req, res) => {
    try {
        const { data, error } = await supabase.from('options').select('id, option_name, type_id').order('option_name', { ascending: true });
        if (error) {
            console.error('Error fetching all options:', error.message);
            return res.status(500).json({ error: 'Failed to fetch all options.' });
        }
        res.status(200).json({ message: 'Options fetched successfully!', options: data });
    } catch (err) {
        console.error('Unexpected error in Fetch All Options:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Add Type
router.post('/add', async (req, res) => {
    const { type_name, user_id } = req.body;

    try {
        // Validate Inputs
        if (!user_id) {
            return res.status(400).json({ error: 'User ID is required.' });
        }

        const isSuper = await isSuperUser(user_id);
        if (!isSuper) {
            return res.status(403).json({ error: 'Only superusers can add types.' });
        }

        const trimmedName = type_name?.trim();
        if (!trimmedName) {
            return res.status(400).json({ error: 'Type name is required.' });
        }

        // Insert Type into Database
        const { data, error } = await supabase
            .from('types')
            .insert([{ type_name: trimmedName }])
            .select();

        if (error) {
            console.error('Insert Error:', error.message);
            return res.status(500).json({ error: 'Failed to add type.' });
        }

        res.status(201).json({
            message: 'Type added successfully!',
            type: data[0],
        });
    } catch (err) {
        console.error('Unexpected Error in Add Type:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Fetch All Types
router.get('/list', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('types')
            .select('*')
            .order('type_name', { ascending: true });

        if (error) {
            console.error('Error Fetching Types:', error.message);
            return res.status(500).json({ error: 'Failed to fetch types.' });
        }

        res.status(200).json({
            message: 'Types fetched successfully!',
            types: data,
        });
    } catch (err) {
        console.error('Error in Fetch Types:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Edit Type
router.patch('/edit', async (req, res) => {
    const { type_id, type_name, user_id } = req.body;

    try {
        // Validate Inputs
        if (!type_id || isNaN(type_id)) {
            return res.status(400).json({ error: 'Valid type ID is required.' });
        }
        if (!type_name || !type_name.trim()) {
            return res.status(400).json({ error: 'Type name is required.' });
        }
        if (!user_id) {
            return res.status(400).json({ error: 'User ID is required.' });
        }

        const isSuper = await isSuperUser(user_id);
        if (!isSuper) {
            return res.status(403).json({ error: 'Only superusers can edit types.' });
        }

        // Update Type Name
        const { data, error } = await supabase
            .from('types')
            .update({ type_name: type_name.trim() })
            .eq('id', parseInt(type_id))
            .select();

        if (error) {
            console.error('Error updating type:', error.message);
            return res.status(500).json({ error: 'Failed to update type.' });
        }

        res.status(200).json({
            message: 'Type updated successfully!',
            type: data[0],
        });
    } catch (err) {
        console.error('Unexpected Error in Edit Type:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Delete Type
router.delete('/delete', async (req, res) => {
    const { type_id, user_id } = req.body;

    try {
        if (!user_id || !type_id || isNaN(type_id)) {
            return res.status(400).json({ error: 'User ID and valid type ID are required.' });
        }

        const isSuper = await isSuperUser(user_id);
        if (!isSuper) {
            return res.status(403).json({ error: 'Only superusers can delete types.' });
        }

        const { error } = await supabase
            .from('types')
            .delete()
            .eq('id', parseInt(type_id));

        if (error) {
            console.error('Error Deleting Type:', error.message);
            return res.status(500).json({ error: 'Failed to delete type.' });
        }

        res.status(200).json({ message: `Type with ID ${type_id} successfully deleted.` });
    } catch (err) {
        console.error('Error in Delete Type:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Add Option to Type
router.post('/option/add', async (req, res) => {
    const { option_name, type_id, user_id } = req.body;

    try {
        if (!user_id || !type_id) {
            return res.status(400).json({ error: 'User ID and type ID are required.' });
        }

        const isSuper = await isSuperUser(user_id);
        if (!isSuper) {
            return res.status(403).json({ error: 'Only superusers can add options.' });
        }

        const trimmedName = option_name?.trim();
        if (!trimmedName) {
            return res.status(400).json({ error: 'Option name is required.' });
        }

        const { data, error } = await supabase
            .from('options')
            .insert([{ option_name: trimmedName, type_id }])
            .select();

        if (error) {
            console.error('Error adding option:', error.message);
            return res.status(500).json({ error: 'Failed to add option.' });
        }

        res.status(201).json({
            message: 'Option added successfully!',
            option: data[0],
        });
    } catch (err) {
        console.error('Unexpected Error in Add Option:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Fetch Options by Type
router.post('/option/list/by-type', async (req, res) => {
    const { type_id } = req.body;

    try {
        if (!type_id) {
            return res.status(400).json({ error: 'Type ID is required.' });
        }

        const { data, error } = await supabase
            .from('options')
            .select('id, option_name')
            .eq('type_id', type_id)
            .order('option_name', { ascending: true });

        if (error) {
            console.error('Error fetching options:', error.message);
            return res.status(500).json({ error: 'Failed to fetch options.' });
        }

        res.status(200).json({
            message: `Options fetched successfully for type ID: ${type_id}`,
            options: data,
        });
    } catch (err) {
        console.error('Unexpected Error in Fetch Options:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Edit Options
router.patch('/option/edit', async (req, res) => {
    const { type_id, add_options = [], remove_option_ids = [], user_id } = req.body;

    try {
        // Validate Inputs
        if (!type_id || !user_id) {
            return res.status(400).json({ error: 'Type ID and User ID are required.' });
        }
        if (add_options.length === 0 && remove_option_ids.length === 0) {
            return res.status(400).json({ error: 'At least one option to add or remove is required.' });
        }

        // Check Superuser Permissions
        const isSuper = await isSuperUser(user_id);
        if (!isSuper) {
            return res.status(403).json({ error: 'Only superusers can edit options.' });
        }

        // Add New Options to the Type
        let addedOptions = [];
        if (add_options.length > 0) {
            const newOptions = add_options.map((option) => ({
                option_name: option.trim(),
                type_id,
            }));

            const { data: addedData, error: addError } = await supabase
                .from('options')
                .insert(newOptions)
                .select();

            if (addError) {
                console.error('Error adding options:', addError.message);
                return res.status(500).json({ error: 'Failed to add new options.' });
            }

            addedOptions = addedData;
        }

        // Remove Existing Options from the Type
        let removedOptions = [];
        if (remove_option_ids.length > 0) {
            const { data: removedData, error: removeError } = await supabase
                .from('options')
                .delete()
                .in('id', remove_option_ids)
                .select();

            if (removeError) {
                console.error('Error removing options:', removeError.message);
                return res.status(500).json({ error: 'Failed to remove options.' });
            }

            removedOptions = removedData;
        }

        res.status(200).json({
            message: 'Options edited successfully!',
            added_options: addedOptions,
            removed_options: removedOptions,
        });
    } catch (err) {
        console.error('Unexpected Error in Edit Options:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Fetch Products by Options
router.post('/products/by-options', async (req, res) => {
    const { option_ids } = req.body; // Extract option IDs from request body

    try {
        // Validate Inputs
        if (!option_ids || option_ids.length === 0) {
            return res.status(400).json({ error: 'At least one option ID is required.' });
        }

        // Fetch Products Linked to the Options
        const { data: productOptions, error: productOptionsError } = await supabase
            .from('product_options')
            .select('product_id')
            .in('option_id', option_ids); // Fetch all products linked to the given options

        if (productOptionsError) {
            console.error('Error fetching products by options:', productOptionsError.message);
            return res.status(500).json({ error: 'Failed to fetch products by options.' });
        }

        if (productOptions.length === 0) {
            return res.status(404).json({ error: 'No products found for the provided options.' });
        }

        // Extract Product IDs from Results
        const productIds = productOptions.map(po => po.product_id);

        // Fetch Detailed Product Information
        const { data: products, error: productsError } = await supabase
            .from('products')
            .select('id, title, price, images, stock_quantity')
            .in('id', productIds);

        if (productsError) {
            console.error('Error fetching product details:', productsError.message);
            return res.status(500).json({ error: 'Failed to fetch product details.' });
        }

        res.status(200).json({
            message: 'Products fetched successfully by options!',
            products,
        });
    } catch (err) {
        console.error('Unexpected Error in Fetch Products by Options:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;

