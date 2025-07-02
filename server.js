// Server for Astro-Runner Multiplayer Game
const WebSocket = require('ws');
const crypto = require('crypto');

// Server listens on port 8080
const wss = new WebSocket.Server({ port: 8080 });

let players = {};
let gameInterval;
let gameState = createInitialGameState();

// Function to create a fresh game state
function createInitialGameState() {
    return {
        status: 'waiting', // Can be 'waiting', 'playing', 'finished'
        obstacles: [],
        speed: 5,
        score: 0,
        highScore: gameState ? gameState.highScore : 0, // Carry over high score
        nextObstacleTime: 0,
        winner: null,
    };
}

// Main game loop function, runs on the server
function updateGame() {
    if (gameState.status !== 'playing') return;

    // Increment score and speed
    gameState.score += gameState.speed * 0.01;
    if (gameState.score > gameState.highScore) {
        gameState.highScore = gameState.score;
    }
    gameState.speed += 0.001;

    // Move obstacles and remove off-screen ones
    gameState.obstacles.forEach(o => o.x -= gameState.speed);
    gameState.obstacles = gameState.obstacles.filter(o => o.x > -50);

    // Create new obstacles periodically
    if (Date.now() > gameState.nextObstacleTime) {
        const type = Math.random() > 0.7 ? 'asteroid' : 'crystal';
        const newObstacle = {
            id: Date.now(),
            type: type,
            x: 1000, // Start just off-screen to the right
            y: type === 'crystal' ? (300 - 50 - 50) : (300 - 50 - 85),
            width: type === 'crystal' ? 25 : 46,
            height: type === 'crystal' ? 50 : 55,
        };
        gameState.obstacles.push(newObstacle);
        // Set time for the next obstacle
        gameState.nextObstacleTime = Date.now() + Math.random() * 1500 + (15000 / gameState.speed);
    }
}

// Function to send data to all connected clients
function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Handle new client connections
wss.on('connection', ws => {
    const id = crypto.randomUUID().substring(0, 8);
    console.log('Player connected:', id);
    
    ws.id = id;
    players[id] = { id: id, state: 'waiting' }; // Initial state
    ws.send(JSON.stringify({ type: 'assign-id', id: id }));

    ws.on('message', message => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'player-ready') {
                players[id].state = 'ready';
                console.log(`Player ${id} is ready.`);
                
                const allPlayers = Object.values(players);
                // Start the game if 2 players are ready
                if (allPlayers.length === 2 && allPlayers.every(p => p.state === 'ready')) {
                    console.log('All players ready. Starting game!');
                    gameState = createInitialGameState();
                    gameState.status = 'playing';
                    broadcast({ type: 'start-game' });
                    if (gameInterval) clearInterval(gameInterval);
                    gameInterval = setInterval(updateGame, 1000 / 60);
                }
            }
            
            if (data.type === 'player-update') {
                if (players[data.player.id]) {
                    players[data.player.id] = data.player;
                }
            }

            if (data.type === 'game-over') {
                players[id].state = 'dead';
                const alivePlayers = Object.values(players).filter(p => p.state !== 'dead');
                if (alivePlayers.length <= 1 && Object.keys(players).length >= 2) {
                    gameState.status = 'finished';
                    gameState.winner = alivePlayers.length > 0 ? alivePlayers[0].id : null; // Handle draw case
                    broadcast({ type: 'game-over', winner: gameState.winner });
                    clearInterval(gameInterval);
                }
            }
            
        } catch (e) {
            console.error('Failed to parse message or handle client update:', e);
        }
    });

    ws.on('close', () => {
        console.log('Player disconnected:', id);
        delete players[id];
        // If a player disconnects mid-game, end the session
        if (Object.keys(players).length < 2 && gameState.status === 'playing') {
            console.log('Not enough players. Stopping game.');
            gameState.status = 'waiting';
            clearInterval(gameInterval);
            broadcast({ type: 'game-over', winner: null });
        }
    });
});

// Broadcast the full game state to all clients periodically
setInterval(() => {
    broadcast({ type: 'game-state', ...gameState, players });
}, 1000 / 30); // 30 times per second

console.log('WebSocket server started on port 8080');
