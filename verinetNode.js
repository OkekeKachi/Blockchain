const express = require('express'); 
const app = express();
const uuid = require('uuid')
const Blockchain = require('./blockchain');
const evian = new Blockchain();
const nodeAddress = uuid.v1().split("-").join("")
const port = process.argv[2] || 3000
console.log(a=process.argv)
const bodyParser = require('body-parser');
const rp = require('request-promise');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.set('view engine', 'ejs');
app.use(express.static('public')); // Ensure this line is present


// GET /blockchain

app.get("/", function (req, res) {
    res.render('index');       
});
app.get("/blockchain", function (req, res) {
    res.render("blockchain", { blockchain: evian })
})

app.post('/transaction/broadcast', (req, res) => {
    const newTransaction = evian.createNewTransaction(req.body.amount, req.body.sender, req.body.recipient);
    evian.addTransactionToPendingTransactions(newTransaction);
    const requestPromises = []
    evian.networkNodes.forEach(networkNodeUrl => {
        const requestOptions = {
            url: `${networkNodeUrl}/transaction/broadcast`,
            method: 'POST',
            body: newTransaction,
            json: true
        };
        requestPromises.push(rp(requestOptions));        
    })    
    Promise.all(requestPromises)
        .then(data => {
            res.json({ note: "Transaction created and broadcast successfully" })
            // res.redirect('/blockchain')
        })
})

// POST /transaction
app.post('/transaction', function (req, res) {
    const newTransaction = req.body;
    
    const blockIndex = evian.addTransactionToPendingTransactions(newTransaction)
    // const blockIndex = JSON.stringify(evian.createNewTransaction(req.body.amount, req.body.sender, req.body.recipient))
    //   res.json({note:`Transaction will be added in block ${blockIndex}`})
    res.redirect("/blockchain")
});

app.get('/seemine', (req, res) => {
    const minedBlocks = evian.chain.filter(block => block.hash && block.hash.startsWith('0000'));
    const lastBlock = minedBlocks.length>0 ?minedBlocks[minedBlocks.length-1]:null
    
    if (
        lastBlock
    ) {
       res.render("mine", { block: lastBlock }) 
    } else {
        res.render("mine", { block: null }) 
    }
})

app.get('/mine', function (req, res) {
    const lastBlock = evian.getLastBlock();
    const previousBlockHash = lastBlock['hash'];
    const currentBlockData = {
        //remove s
        transactions: evian.pendingTransactions,
        index: lastBlock['index'] + 1
    };
    const nonce = evian.proofOfWork(previousBlockHash, currentBlockData);
    const blockHash = evian.hashBlock(previousBlockHash, currentBlockData, nonce);
    const newBlock = evian.createNewBlock(nonce, previousBlockHash, blockHash);

    const requestPromises = evian.networkNodes.map(networkNodeUrl => {
        const requestOptions = {
            url: `${networkNodeUrl}/receive-new-block`,
            method: 'POST',
            body: { newBlock: newBlock },
            json: true
        };
        return rp(requestOptions);
    });

    Promise.all(requestPromises).then(data => {
        res.render('mine', { block: newBlock });
    }).catch(err => {
        console.error("Error broadcasting new block:", err);
        res.status(500).json({ error: "Failed to broadcast the new block." });
    });
});


app.post('/receive-new-block', (req, res) => {
    const newBlock = req.body.newBlock;
    const lastBlock = evian.getLastBlock();
    const correctHash = lastBlock.hash === newBlock.previousBlockHash;
    const correctIndex = lastBlock['index'] + 1 === newBlock.index;

    if (correctHash && correctIndex) {
        evian.chain.push(newBlock);
        evian.pendingTransactions = [];
        res.status(200).json({
            note: "New block received and accepted.",
            newBlock: newBlock
        });
    } else {
        res.status(400).json({
            note: "New block rejected.",
            newBlock: newBlock
        });
    }
});


app.get('/register', (req, res) => {
    res.render('register');
});


// // register a node and broadcast it to the network
// app.post('/register-and-broadcast',function(req,res){
//     const newNodeUrl =req.body.newNodeUrl;
//     if(evian.networkNodes.indexOf(newNodeUrl)==-1){
//         evian.networkNodes.push(newNodeUrl)
//     }
//     const regNodesPromises = [];
//     evian.networkNodes.forEach(networkNodeUrl =>{
//         const requestOptions = {
//             url: networkNodeUrl + '/register-node',
//             method: 'POST',
//             body: {newNodeUrl:newNodeUrl},
//             json: true
//         };
//         regNodesPromises.push(rp(requestOptions))
//     });
//     Promise.all(regNodesPromises).then(data=>{
//         const bulkRegisterOptions = {
//             url: newNodeUrl + '/register-nodes-bulk',
//             method: 'POST',
//             body: {allNetworkNodes: [evian.networkNodes, evian.currentNodeUrl]},
//             json: true
//         };
//         return rp(bulkRegisterOptions);
//     })
//     .then(data=>{
//         res.json({note: 'new node registered with network successfully'});
//     });
// });




app.post('/register-and-broadcast', function (req, res) {
    const newNodeUrl = req.body.newNodeUrl;

    // Check if the node is already in the list of registered nodes
    if (evian.networkNodes.indexOf(newNodeUrl) === -1) {
        evian.networkNodes.push(newNodeUrl);  // Add the new node to the list
    }

    // Prepare the request promises to register this node with other nodes in the network
    const regNodesPromises = evian.networkNodes.map(networkNodeUrl => {
        const requestOptions = {
            url: `${networkNodeUrl}/register-node`,
            method: 'POST',
            body: { newNodeUrl: newNodeUrl },
            json: true
        };
        return rp(requestOptions);
    });
    console.log(evian.networkNodes)
    console.log(newNodeUrl);
    
    // Execute all promises
    Promise.all(regNodesPromises)
        .then(() => {
            // Now that other nodes are registered, broadcast all nodes
            console.log("hello");
            
            const bulkRegisterOptions = {
                url: `${newNodeUrl}/register-nodes-bulk`,
                method: 'POST',                
                body: { allNetworkNodes: [...evian.networkNodes, evian.currentNodeUrl] },
                json: true
            };
            console.log(evian.currentNodeUrl);
            
            return rp(bulkRegisterOptions);   
            
        })
        .then(() => {
            // Respond once the registration is complete
            // res.json({ note: 'New node registered with network successfully' });
            res.redirect("/blockchain")
        })
        .catch((error) => {
            // Handle any error that occurs during registration
            console.error(error);
            res.status(500).json({ error: 'There was an error registering the node' });
        });
});


// register a node with the network
app.post('/register-node', function(req,res){
    const newNodeUrl = req.body.newNodeUrl;
    const broadcast = req.body.broadcast;

    
    const nodeNotAlreadyPresent = evian.networkNodes.indexOf(newNodeUrl) == -1
    const notCurrentNode = evian.currentNodeUrl !== newNodeUrl;
    if(nodeNotAlreadyPresent && notCurrentNode){
        evian.networkNodes.push(newNodeUrl);
    };
    // res.json({note:'New node registered successfully'})
    if (broadcast) {
        res.redirect("/blockchain")  
    } else {
        res.status(200).json({ message: 'Node registered successfully' });
    }
    
    
});
// register multiple nodes at once
app.post('/register-nodes-bulk', function (req, res) {    
    let allNetworkNodes = req.body.allNetworkNodes;
    const broadcast = req.body.broadcast;
    if (!Array.isArray(allNetworkNodes)) {
        if (typeof allNetworkNodes === 'string') {
            // Split by comma and trim whitespace
            allNetworkNodes = allNetworkNodes.split(',').map(url => url.trim());
        } else {
            return res.status(400).json({ error: 'Invalid data format. Expected an array or comma-separated string of network nodes.' });
        }
    }   
    allNetworkNodes.forEach(networkNodeUrl=>{
        const nodeNotAlreadyPresent= evian.networkNodes.indexOf(networkNodeUrl)==-1;
        const notCurrentNode = evian.currentNodeUrl !== networkNodeUrl;
        if(nodeNotAlreadyPresent && notCurrentNode) evian.networkNodes.push(networkNodeUrl);
        console.log("registering");
        
    });
    // res.json({note: 'Bulk registration successful'})
    if (broadcast) {
        res.redirect("/blockchain")
    } else {
        res.status(200).json({ message: 'Node registered successfully' });
    }
});

// Start the server on port 3000
app.listen(port, function() {
    console.log(`Listening on port ${port}...`);
});
