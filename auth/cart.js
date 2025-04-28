const express = require('express');
const { supabase } = require('../supabaseClient');
const router = express.Router();
const nodemailer = require('nodemailer');

// Helper Function: Send Order Details Email
const sendOrderDetailsEmail = async (email, order, items, userName, superuserName = 'Manager') => {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_ADDRESS,
            pass: process.env.EMAIL_PASSWORD,
        },
    });

    // Parse delivery_address if it's a string
    let deliveryAddress = order.delivery_address;
    try {
        deliveryAddress = typeof order.delivery_address === 'string'
            ? JSON.parse(order.delivery_address)
            : order.delivery_address;
    } catch (error) {
        console.error('Error parsing delivery address JSON:', error.message);
        deliveryAddress = { address_line_1: 'Unknown', city: 'Unknown', state: 'Unknown', country: 'Unknown', postal_code: 'N/A', phone_number: 'N/A' };
    }

    // Calculate total order amount
    const totalOrderAmount = items.reduce((sum, item) => sum + item.price, 0);

    // Map items for display in the email
    const itemRows = items.map((item) => {
        // Format options column as "type_name: option_name"
        const options = item.options && item.options.length > 0
            ? item.options.map(opt => `${opt.type_name}: ${opt.name}`).join(', ')
            : 'Not Specified';

        return `
            <tr>
                <td style="border: 1px solid #ddd; padding: 10px;">${item.title}</td>
                <td style="border: 1px solid #ddd; padding: 10px;">${options}</td>
                <td style="border: 1px solid #ddd; padding: 10px;">${item.quantity}</td>
                <td style="border: 1px solid #ddd; padding: 10px;">₹${item.price.toFixed(2)}</td>
            </tr>
        `;
    }).join('');

    // Delivery or Pickup Details
    const deliveryDetails = order.delivery_type === "Delivery" && deliveryAddress
        ? `
            <h3 style="font-size: 16px; color: #333;">Delivery Address:</h3>
            <p><strong>${deliveryAddress.address_line_1 || 'Unknown'}</strong></p>
            ${deliveryAddress.address_line_2 ? `<p>${deliveryAddress.address_line_2}</p>` : ""}
            <p>${deliveryAddress.city || 'Unknown'}, ${deliveryAddress.state || 'Unknown'}, ${deliveryAddress.country || 'Unknown'} - ${deliveryAddress.postal_code || 'N/A'}</p>
            <p><strong>Phone:</strong> ${deliveryAddress.phone_number || 'N/A'}</p>
        `
        : `
            <h3 style="font-size: 16px; color: #333;">Pickup Information:</h3>
            <p>Your order is set for <strong>pickup</strong>. Please contact the manager for more details.</p>
        `;

    // Email Content
    const mailOptions = {
        from: process.env.EMAIL_ADDRESS,
        to: email,
        subject: `Your Order Details (#${order.id})`,
        html: `
            <div style="font-family: Arial, sans-serif; color: #333; padding: 30px; background-color: #f9f9f9; border: 1px solid #ddd; border-radius: 8px;">
                <h1 style="font-size: 24px; margin-bottom: 20px; color: #007bff;">Order Confirmation</h1>
                <p><strong>Order ID:</strong> ${order.id}</p>
                <p><strong>Placed By:</strong> ${userName}</p>
                <p><strong>Managed By:</strong> ${superuserName}</p>
                <p><strong>Status:</strong> ${order.order_status || 'Pending'}</p>
                <p><strong>Created At:</strong> ${order.created_at ? new Date(order.created_at).toLocaleString() : 'N/A'}</p>
                
                ${deliveryDetails}
                
                <h2 style="font-size: 20px; margin-top: 20px; color: #333;">Order Items:</h2>
                <table style="border-collapse: collapse; width: 100%; margin: 20px auto; background-color: #fff; border: 1px solid #ddd; border-radius: 5px;">
                    <thead style="background-color: #007bff; color: #fff;">
                        <tr>
                            <th style="border: 1px solid #ddd; padding: 10px;">Product</th>
                            <th style="border: 1px solid #ddd; padding: 10px;">Options</th>
                            <th style="border: 1px solid #ddd; padding: 10px;">Quantity</th>
                            <th style="border: 1px solid #ddd; padding: 10px;">Price</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemRows}
                    </tbody>
                </table>

                <p><strong>Total Order Amount:</strong> ₹${totalOrderAmount.toFixed(2)}</p>

                <p style="margin-top: 20px; font-size: 14px; color: #666;">Thank you for shopping with us! If you have questions, feel free to contact our support team.</p>
            </div>
        `,
    };

    // Send email
    try {
        await transporter.sendMail(mailOptions);
        console.log(`Order details email sent to ${email}`);
    } catch (err) {
        console.error(`Error sending email to ${email} (Order ID: ${order.id}):`, err.message);
        throw new Error('Failed to send order details email.');
    }
};

// Add Product to Cart
router.post('/add', async (req, res) => {
    const { user_id, product_id, option_ids, quantity } = req.body;

    try {
        // Validate input
        if (!user_id || !product_id || !quantity || quantity <= 0) {
            return res.status(400).json({ error: 'User ID, Product ID, and valid quantity are required.' });
        }

        // Fetch product details along with its valid options
        const { data: product, error: productError } = await supabase
            .from('products')
            .select(`
                id,
                options:product_options (
                    option_id
                )
            `)
            .eq('id', product_id)
            .single();

        if (productError || !product) {
            console.error(`Error fetching product with ID ${product_id}:`, productError?.message || 'Product not found.');
            return res.status(404).json({ error: 'Product not found.' });
        }

        // Check if the product has associated options
        const validOptionIds = product.options?.map(option => option.option_id) || [];
        const hasOptions = validOptionIds.length > 0;

        // Make options mandatory if the product has associated options
        if (hasOptions) {
            if (!Array.isArray(option_ids) || option_ids.length === 0) {
                return res.status(400).json({ error: 'Option IDs are mandatory for this product and cannot be empty.' });
            }

            const areOptionsValid = option_ids.every(optionId => validOptionIds.includes(optionId));
            if (!areOptionsValid) {
                return res.status(400).json({ error: 'One or more selected options are invalid for this product.' });
            }
        }

        // Check if the product already exists in the cart
        const { data: existingCartItem, error: existingCartError } = await supabase
            .from('cart')
            .select('id, quantity')
            .eq('user_id', user_id)
            .eq('product_id', product_id)
            .maybeSingle(); // Use maybeSingle() to handle no rows gracefully

        if (existingCartError) {
            console.error('Error checking existing cart item:', existingCartError?.message);
            return res.status(500).json({ error: 'Internal server error.' });
        }

        // If the product already exists, update the quantity
        if (existingCartItem) {
            const updatedQuantity = existingCartItem.quantity + quantity;

            const { data: updatedCartItem, error: updateError } = await supabase
                .from('cart')
                .update({ quantity: updatedQuantity, updated_at: new Date() })
                .eq('id', existingCartItem.id)
                .select()
                .single();

            if (updateError) {
                console.error('Error updating cart item:', updateError?.message);
                return res.status(500).json({ error: 'Failed to update cart item quantity.' });
            }

            return res.status(200).json({
                message: 'Cart item quantity updated successfully!',
                cart_item: updatedCartItem
            });
        }

        let finalPrice;

        // Fetch combo price only if option_ids are provided and valid
        if (Array.isArray(option_ids) && option_ids.length > 0) {
            const { data: comboData, error: comboError } = await supabase
                .from('types_combo')
                .select('combo_price')
                .eq('product_id', product_id)
                .eq('options', `{${option_ids.join(',')}}`)
                .single();

            if (comboError || !comboData) {
                console.error(`Error fetching combo price for product ID ${product_id} and selected options:`, comboError?.message || 'Combo not found.');
                return res.status(400).json({ error: 'The selected combo is not available.' });
            }

            // Calculate final price based on the combo price and quantity
            finalPrice = comboData.combo_price * quantity;
        } else {
            // If no combo price is required, calculate the price as a default fallback
            const { data: productPrice, error: priceError } = await supabase
                .from('products')
                .select('price') // Ensure price is fetched for products without options
                .eq('id', product_id)
                .single();

            if (priceError || !productPrice) {
                console.error(`Error fetching price for product ID ${product_id}:`, priceError?.message || 'Price not found.');
                return res.status(400).json({ error: 'Unable to retrieve product price.' });
            }

            finalPrice = productPrice.price * quantity;
        }

        // Insert product into the cart with the final price
        const { data: cartItem, error: cartInsertError } = await supabase
            .from('cart')
            .insert([{ user_id, product_id, quantity, final_price: finalPrice }]) // Add final_price
            .select()
            .single();

        if (cartInsertError || !cartItem) {
            console.error('Error adding product to cart:', cartInsertError?.message);
            return res.status(500).json({ error: 'Failed to add product to cart.' });
        }

        const cartItemId = cartItem.id;

        // Insert options into the cart_item_options table (if applicable)
        if (hasOptions && Array.isArray(option_ids) && option_ids.length > 0) {
            const cartItemOptions = option_ids.map(optionId => ({
                cart_item_id: cartItemId,
                option_id: optionId
            }));

            const { error: cartOptionsError } = await supabase
                .from('cart_item_options')
                .insert(cartItemOptions);

            if (cartOptionsError) {
                console.error('Error adding options for the cart item:', cartOptionsError?.message);
                return res.status(500).json({ error: 'Failed to add options for the cart item.' });
            }
        }

        // Respond with success
        res.status(201).json({
            message: 'Product successfully added to cart!',
            cart_item: cartItem,
            options: hasOptions ? option_ids : []
        });
    } catch (error) {
        console.error('Unexpected error:', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Fetch Cart Items
router.post('/fetch', async (req, res) => {
    const { user_id } = req.body;

    try {
        // Validate input
        if (!user_id) {
            return res.status(400).json({ error: 'User ID is required to fetch cart items.' });
        }

        // Fetch cart items for the user
        const { data: cartItems, error: cartError } = await supabase
            .from('cart')
            .select(`
                id,
                product_id,
                quantity,
                final_price,
                created_at,
                updated_at,
                products (
                    id,
                    title,
                    description,
                    images,
                    stock_quantity
                ),
                cart_item_options (
                    option_id,
                    options (
                        option_name,
                        type_id,
                        types (
                            type_name
                        )
                    )
                )
            `)
            .eq('user_id', user_id);

        if (cartError) {
            console.error('Error fetching cart items:', cartError.message);
            return res.status(500).json({ error: 'Failed to fetch cart items.' });
        }

        // Format the response for better readability
        const formattedCartItems = cartItems.map(cartItem => ({
            cart_id: cartItem.id,
            product_id: cartItem.product_id,
            product: {
                id: cartItem.products.id,
                title: cartItem.products.title,
                description: cartItem.products.description,
                images: cartItem.products.images,
                stock_quantity: cartItem.products.stock_quantity
            },
            options: cartItem.cart_item_options.map(option => ({
                id: option.option_id,
                name: option.options.option_name,
                type_id: option.options.type_id,
                type_name: option.options.types.type_name,
            })),
            quantity: cartItem.quantity,
            final_price: cartItem.final_price,
            created_at: cartItem.created_at,
            updated_at: cartItem.updated_at
        }));

        // Respond with the formatted cart items
        res.status(200).json({
            message: 'Cart items fetched successfully!',
            cart_items: formattedCartItems
        });
    } catch (err) {
        console.error('Unexpected error while fetching cart items:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});


// Delete Product from Cart
router.delete('/delete', async (req, res) => {
    const { user_id, cart_item_id } = req.body;

    try {
        // Validate input
        if (!user_id || !cart_item_id) {
            return res.status(400).json({ error: 'User ID and Cart Item ID are required to delete a product from the cart.' });
        }

        // Check if the cart item exists before attempting to delete
        const { data: existingItem, error: fetchError } = await supabase
            .from('cart')
            .select('*')
            .eq('id', cart_item_id)
            .eq('user_id', user_id)
            .single();

        if (fetchError || !existingItem) {
            return res.status(404).json({ error: 'Cart item not found.' });
        }

        // Delete associated options from cart_item_options table
        const { error: deleteOptionsError } = await supabase
            .from('cart_item_options')
            .delete()
            .eq('cart_item_id', cart_item_id);

        if (deleteOptionsError) {
            console.error('Error deleting options for cart item:', deleteOptionsError.message);
            return res.status(500).json({ error: 'Failed to delete associated options.' });
        }

        // Delete the product from the cart
        const { error: deleteItemError } = await supabase
            .from('cart')
            .delete()
            .eq('id', cart_item_id)
            .eq('user_id', user_id);

        if (deleteItemError) {
            console.error('Error deleting product from cart:', deleteItemError.message);
            return res.status(500).json({ error: 'Failed to delete product from cart.' });
        }

        res.status(200).json({
            message: 'Product and associated options removed from cart successfully!',
            deleted_item: existingItem // Return the previously fetched item as confirmation
        });
    } catch (err) {
        console.error('Unexpected error while deleting from cart:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Place Order from Cart
// Place Order from Cart
router.post('/place/order', async (req, res) => {
  const { user_id, cart_id, delivery_type } = req.body;

  // Validate input for user and cart IDs
  if (!user_id) {
    return res.status(400).json({ error: 'User ID is required to place an order.' });
  }

  if (!cart_id || !Array.isArray(cart_id) || cart_id.length === 0) {
    return res.status(400).json({ error: 'Cart ID must be provided as a non-empty array.' });
  }

  if (!delivery_type || !['Pickup', 'Delivery'].includes(delivery_type)) {
    return res.status(400).json({ error: 'Delivery type must be either "Pickup" or "Delivery".' });
  }

  try {
    // Fetch cart items from the selected cart(s) along with associated options and final price
    const { data: cartItems, error: cartError } = await supabase
      .from('cart')
      .select(`
        id,
        product_id,
        quantity,
        final_price, 
        cart_item_options (
          option_id,
          options (
            option_name,
            type_id,
            types (
              type_name
            )
          )
        ),
        products (
          id,
          title,
          images
        )
      `)
      .eq('user_id', user_id)
      .in('id', cart_id);

    if (cartError || !cartItems || cartItems.length === 0) {
      return res.status(400).json({ error: 'No items in the cart to place an order.' });
    }

    console.log('Cart Items:', cartItems);

    // Fetch user's username for order details
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('username')
      .eq('id', user_id)
      .single();

    if (userError || !userData) {
      console.error('Error fetching user details:', userError?.message || 'User not found.');
      return res.status(400).json({ error: 'Failed to retrieve user details for the order.' });
    }
    const userName = userData.username || 'Unknown User';

    // Handle delivery type and address; for Delivery, fetch user's address
    let deliveryAddress = null;
    if (delivery_type === 'Delivery') {
      const { data: userInfo, error: userInfoError } = await supabase
        .from('info')
        .select('phone_number, address_line_1, address_line_2, city, state, country, postal_code')
        .eq('user_id', user_id)
        .single();

      if (userInfoError || !userInfo) {
        console.error('No address found for this user:', userInfoError?.message);
        return res.status(400).json({ error: 'No saved address found. Please save an address first.' });
      }
      deliveryAddress = userInfo;
    }

    // Fetch superuser (manager) information
    const { data: superuserData, error: superuserError } = await supabase
      .from('superusers')
      .select('id, username, email')
      .limit(1)
      .single();

    if (superuserError || !superuserData) {
      console.error('Failed to fetch superuser information:', superuserError?.message);
      return res.status(500).json({ error: 'Failed to retrieve manager information.' });
    }
    const superuser_id = superuserData.id;
    const superuser_email = superuserData.email;
    const superuser_name = superuserData.username || 'Manager';

    // Create a new order entry
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .insert([
        {
          user_id,
          order_status: 'Pending',
          created_at: new Date().toISOString(),
          delivery_type,
          delivery_address: deliveryAddress ? JSON.stringify(deliveryAddress) : null,
        },
      ])
      .select()
      .single();

    if (orderError) {
      console.error('Error creating order:', orderError.message);
      return res.status(500).json({ error: 'Failed to create the order.' });
    }
    const orderId = orderData.id;

    // Build detailed items for order details using the cart items
    const detailedItems = cartItems.map(cartItem => ({
      order_id: orderId,
      product_id: cartItem.product_id,
      title: cartItem.products.title,
      price: cartItem.final_price,
      images: cartItem.products.images,
      options: cartItem.cart_item_options?.map(option => ({
        id: option.option_id,
        name: option.options.option_name,
        type_id: option.options.type_id,
        type_name: option.options.types.type_name,
      })) || [],
      quantity: cartItem.quantity,
    }));

    // Prepare order items for insertion into the orderitems table
    const orderItems = detailedItems.map(item => ({
      order_id: item.order_id,
      product_id: item.product_id,
      price: item.price,
      quantity: item.quantity,
    }));

    const { data: insertedOrderItems, error: orderItemsError } = await supabase
      .from('orderitems')
      .insert(orderItems)
      .select();

    if (orderItemsError) {
      console.error('Error adding items to the order:', orderItemsError.message);
      return res.status(500).json({ error: 'Failed to add items to the order.' });
    }

    // Build and insert order item options into order_item_options table
    const orderItemOptions = [];
    insertedOrderItems.forEach(orderItem => {
      const cartItem = cartItems.find(item => item.product_id === orderItem.product_id);
      if (cartItem && cartItem.cart_item_options) {
        cartItem.cart_item_options.forEach(option => {
          orderItemOptions.push({
            order_item_id: orderItem.id,
            option_id: option.option_id,
          });
        });
      }
    });

    if (orderItemOptions.length > 0) {
      const { error: orderOptionsError } = await supabase
        .from('order_item_options')
        .insert(orderItemOptions);

      if (orderOptionsError) {
        console.error('Error adding options to the order items:', orderOptionsError.message);
        return res.status(500).json({ error: 'Failed to add options to the order.' });
      }
    }

    console.log('Order Items with Options:', orderItemOptions);

    // Update stock quantities for each ordered product
    const updateStockPromises = detailedItems.map(async (item) => {
      const { data: productData, error: stockError } = await supabase
        .from('products')
        .select('stock_quantity')
        .eq('id', item.product_id)
        .single();
      if (stockError || !productData) {
        throw new Error(`Failed to fetch stock quantity for product ID ${item.product_id}.`);
      }
      const newStock = productData.stock_quantity - item.quantity;
      if (newStock < 0) {
        throw new Error(`Insufficient stock for product ID ${item.product_id}.`);
      }
      const { error: updateError } = await supabase
        .from('products')
        .update({ stock_quantity: newStock })
        .eq('id', item.product_id);
      if (updateError) {
        throw new Error(`Failed to update stock for product ID ${item.product_id}.`);
      }
    });
    await Promise.all(updateStockPromises);

    // Clear the selected cart items after the order is placed
    const { error: clearCartError } = await supabase
      .from('cart')
      .delete()
      .eq('user_id', user_id)
      .in('id', cart_id);

    if (clearCartError) {
      console.error('Error clearing cart:', clearCartError.message);
      return res.status(500).json({ error: 'Failed to clear the cart.' });
    }

    // Create a notification message in the messages table (without order_id)
    const { data: messageData, error: messageError } = await supabase
      .from('messages')
      .insert([
        {
          sender: superuser_id,
          message: `Your order has been placed successfully! Order ID: ${orderId}. Thank you for shopping with us.`,
          read_status: false,
          is_edited: false,
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (messageError) {
      console.error('Error creating message:', messageError.message);
      return res.status(500).json({ error: 'Failed to send notification message.' });
    }

    // Link the created message to the order using the order_messages table
    const { error: linkError } = await supabase
      .from('order_messages')
      .insert([
        {
          order_id: orderId,
          message_id: messageData.id,
          linked_at: new Date().toISOString(),
        },
      ]);

    if (linkError) {
      console.error('Error linking message to order:', linkError.message);
      return res.status(500).json({ error: 'Failed to link message to the order.' });
    }

    // Send email with order details
    await sendOrderDetailsEmail(
      superuser_email,
      { ...orderData, delivery_address: deliveryAddress },
      detailedItems,
      userName,
      superuser_name
    );

    res.status(201).json({
      message: 'Order placed successfully!',
      order: orderData,
      order_items: detailedItems,
    });
  } catch (err) {
    console.error('Unexpected error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Update Quantity in Cart
router.post('/update-quantity', async (req, res) => {
    const { user_id, cart_id, quantity } = req.body;

    // Validate input
    if (!user_id || !cart_id || !quantity || quantity <= 0) {
        return res.status(400).json({ error: 'User ID, Cart ID, and valid quantity are required.' });
    }

    try {
        // Fetch the cart item to ensure it exists and belongs to the user
        const { data: cartItem, error: cartError } = await supabase
            .from('cart')
            .select('product_id, final_price') // Fetch necessary fields
            .eq('id', cart_id)
            .eq('user_id', user_id)
            .single();

        if (cartError || !cartItem) {
            console.error('Error fetching cart item:', cartError?.message || 'Cart item not found.');
            return res.status(404).json({ error: 'Cart item not found or does not belong to the user.' });
        }

        // Fetch the product price from the database for recalculating final price
        const { data: productData, error: productError } = await supabase
            .from('products')
            .select('price') // Fetch product price
            .eq('id', cartItem.product_id)
            .single();

        if (productError || !productData) {
            console.error('Error fetching product price:', productError?.message || 'Product not found.');
            return res.status(404).json({ error: 'Product not found for the cart item.' });
        }

        const newFinalPrice = productData.price * quantity;

        // Update the quantity and final price in the cart
        const { data: updatedCartItem, error: updateError } = await supabase
            .from('cart')
            .update({ quantity, final_price: newFinalPrice, updated_at: new Date().toISOString() })
            .eq('id', cart_id)
            .select()
            .single();

        if (updateError || !updatedCartItem) {
            console.error('Error updating cart item:', updateError?.message || 'Update failed.');
            return res.status(500).json({ error: 'Failed to update cart item.' });
        }

        // Respond with the updated cart item
        res.status(200).json({
            message: 'Cart item updated successfully!',
            cart_item: updatedCartItem,
        });
    } catch (err) {
        console.error('Unexpected error updating cart item:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
