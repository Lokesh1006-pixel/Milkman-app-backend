const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const excelJS = require('exceljs');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());
app.set('json spaces', 2); // Enable pretty print for JSON responses

// Serve frontend from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
const dbPath = path.join(__dirname, 'milkman_data.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error(err.message);
    console.log('Connected to SQLite database');
});

// Create customers table
db.run(`CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price_per_kg REAL NOT NULL
)`);

// Create deliveries table
db.run(`CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    date TEXT,
    quantity REAL,
    FOREIGN KEY (customer_id) REFERENCES customers (id)
)`);

// Root endpoint
app.get('/', (req, res) => {
    res.send('Milkman App API is running!');
});

// Add new customer
app.post('/customers', (req, res) => {
    const { name, price_per_kg } = req.body;
    db.run('INSERT INTO customers (name, price_per_kg) VALUES (?, ?)', [name, price_per_kg], function(err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ id: this.lastID, name, price_per_kg });
    });
});

// Get all customers
app.get('/customers', (req, res) => {
    db.all('SELECT * FROM customers', [], (err, rows) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json(rows);
    });
});

// Delete customers (multiple)
app.post('/customers/delete', (req, res) => {
    const { ids } = req.body; // Expecting an array of customer IDs
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'No customer IDs provided.' });
    }
    const placeholders = ids.map(() => '?').join(',');
    db.run(`DELETE FROM customers WHERE id IN (${placeholders})`, ids, function(err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ deleted: this.changes });
    });
});

// Record milk delivery
app.post('/deliveries', (req, res) => {
    const { customer_id, date, quantity } = req.body;
    db.run('INSERT INTO deliveries (customer_id, date, quantity) VALUES (?, ?, ?)',
        [customer_id, date, quantity], function(err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ id: this.lastID, customer_id, date, quantity });
    });
});

// Get deliveries for a customer (date-wise)
app.get('/deliveries/:customerId', (req, res) => {
    const customerId = req.params.customerId;
    db.all('SELECT * FROM deliveries WHERE customer_id = ? ORDER BY date DESC', [customerId], (err, rows) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json(rows);
    });
});

// Monthly summary for all customers
app.get('/summary/:month', (req, res) => {
    const month = req.params.month; // Format: YYYY-MM
    const startDate = `${month}-01`;
    const endDate = `${month}-31`;

    const query = `
        SELECT c.name, c.price_per_kg, SUM(d.quantity) as total_quantity,
               SUM(d.quantity) * c.price_per_kg AS total_amount
        FROM customers c
        JOIN deliveries d ON c.id = d.customer_id
        WHERE d.date BETWEEN ? AND ?
        GROUP BY c.id
    `;

    db.all(query, [startDate, endDate], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Export PDF report
app.get('/export/pdf/:month', (req, res) => {
    const month = req.params.month;
    const startDate = `${month}-01`;
    const endDate = `${month}-31`;

    const query = `
        SELECT c.name, c.price_per_kg, SUM(d.quantity) as total_quantity,
               SUM(d.quantity) * c.price_per_kg AS total_amount
        FROM customers c
        JOIN deliveries d ON c.id = d.customer_id
        WHERE d.date BETWEEN ? AND ?
        GROUP BY c.id
    `;

    db.all(query, [startDate, endDate], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const doc = new PDFDocument();
        const filePath = path.join(__dirname, `summary-${month}.pdf`);
        doc.pipe(fs.createWriteStream(filePath));

        doc.fontSize(18).text(`Monthly Summary for ${month}`, { align: 'center' });
        doc.moveDown();

        rows.forEach(row => {
            doc.fontSize(12).text(
                `Name: ${row.name} | Qty: ${row.total_quantity} L | ₹/kg: ${row.price_per_kg} | Total: ₹${row.total_amount.toFixed(2)}`
            );
        });

        doc.end();
        doc.on('finish', () => {
            res.download(filePath);
        });
    });
});

// Export Excel report
app.get('/export/excel/:month', async (req, res) => {
    const month = req.params.month;
    const startDate = `${month}-01`;
    const endDate = `${month}-31`;

    const query = `
        SELECT c.name, c.price_per_kg, SUM(d.quantity) as total_quantity,
               SUM(d.quantity) * c.price_per_kg AS total_amount
        FROM customers c
        JOIN deliveries d ON c.id = d.customer_id
        WHERE d.date BETWEEN ? AND ?
        GROUP BY c.id
    `;

    db.all(query, [startDate, endDate], async (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const workbook = new excelJS.Workbook();
        const worksheet = workbook.addWorksheet(`Summary ${month}`);
        worksheet.columns = [
            { header: 'Customer Name', key: 'name', width: 30 },
            { header: 'Price per Kg', key: 'price_per_kg', width: 15 },
            { header: 'Total Quantity (L)', key: 'total_quantity', width: 20 },
            { header: 'Total Amount (₹)', key: 'total_amount', width: 20 },
        ];

        worksheet.addRows(rows);

        const filePath = path.join(__dirname, `summary-${month}.xlsx`);
        await workbook.xlsx.writeFile(filePath);
        res.download(filePath);
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});