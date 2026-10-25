const express = require('express');
const path = require('path');
const MISTRAL_API_KEY = "sk-ant-9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba";
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.send('rollback apos patch por erro sintaxe em auxiliar'));
app.listen(4102, () => console.log('server on :4102'));
