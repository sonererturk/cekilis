const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const cors = require('cors');
const { WebcastPushConnection } = require('tiktok-live-connector');

app.use(cors());
app.use(express.json());

// Hata mesajları sözlüğü
const errorMessages = {
    'LIVE has ended': 'Canlı yayın bulunamadı',
    'LIVE_HAS_ENDED': 'Canlı yayın bulunamadı',
    'Failed to retrieve room_id': 'Böyle bir kullanıcı bulunamadı',
    '19881007': 'Böyle bir kullanıcı bulunamadı',
    'user_not_found': 'Böyle bir kullanıcı bulunamadı',
    'API Error': 'Böyle bir kullanıcı bulunamadı',
    'Room not found': 'Canlı yayın bulunamadı',
    'Connection closed': 'Bağlantı kesildi',
    'Network error': 'İnternet bağlantınızı kontrol edin'
};

// Hata mesajını Türkçeleştiren fonksiyon
function getLocalizedError(error) {
    if (typeof error === 'string') {
        for (const [key, value] of Object.entries(errorMessages)) {
            if (error.includes(key)) {
                return value;
            }
        }
    }
    return 'Bilinmeyen bir hata oluştu';
}

// Çekiliş katılımcılarını tutacak set
let participants = new Map(); // userId -> participant object
let targetKeyword = '';
let allowDuplicateUsers = false;

io.on('connection', (socket) => {
    let tiktokConnection;

    // TikTok odasına bağlanma
    socket.on('connect-to-room', async ({ username, keyword, allowDuplicates }) => {
        try {
            // Önceki bağlantıyı temizle
            if (tiktokConnection) {
                tiktokConnection.disconnect();
                participants.clear();
            }

            targetKeyword = keyword.toLowerCase();
            allowDuplicateUsers = allowDuplicates;
            tiktokConnection = new WebcastPushConnection(username);
            
            try {
                await tiktokConnection.connect();
                socket.emit('connection-success', {
                    type: 'success',
                    message: `${username} kullanıcısının yayınına başarıyla bağlanıldı!`
                });
            } catch (connectError) {
                socket.emit('connection-success', {
                    type: 'error',
                    message: getLocalizedError(connectError.message || connectError)
                });
                return;
            }

            // Bağlantı hata olaylarını dinle
            tiktokConnection.on('error', (err) => {
                socket.emit('connection-success', {
                    type: 'error',
                    message: getLocalizedError(err.message || err)
                });
            });

            tiktokConnection.on('disconnect', () => {
                socket.emit('connection-success', {
                    type: 'error',
                    message: 'Canlı yayın bağlantısı kesildi'
                });
            });

            // Chat mesajlarını dinle
            tiktokConnection.on('chat', (data) => {
                const message = data.comment.toLowerCase();
                
                // Hedef kelimeyi içeren mesajları kontrol et
                if (message.includes(targetKeyword)) {
                    const participant = {
                        username: data.nickname,
                        message: data.comment,
                        profilePicture: data.profilePictureUrl,
                        userId: data.userId
                    };

                    // Eğer aynı kullanıcı daha önce katıldıysa ve tekrar katılım kapalıysa
                    if (!allowDuplicateUsers && participants.has(data.userId)) {
                        socket.emit('duplicate-entry', {
                            username: data.nickname,
                            message: 'Bu kullanıcı zaten katılmış!',
                            profilePicture: data.profilePictureUrl
                        });
                        return;
                    }

                    // Kullanıcıyı katılımcılara ekle
                    if (allowDuplicateUsers) {
                        const uniqueId = `${data.userId}_${Date.now()}`;
                        participants.set(uniqueId, participant);
                    } else {
                        participants.set(data.userId, participant);
                    }

                    socket.emit('valid-message', participant);
                    socket.emit('participant-count', participants.size);
                }
            });

        } catch (err) {
            socket.emit('error', getLocalizedError(err.message || err));
        }
    });

    // Çekiliş yapma
    socket.on('draw-winner', () => {
        if (participants.size === 0) {
            socket.emit('error', 'Henüz katılımcı yok!');
            return;
        }

        const participantsArray = Array.from(participants.values());
        const randomIndex = Math.floor(Math.random() * participantsArray.length);
        const winner = participantsArray[randomIndex];

        socket.emit('winner', winner);
    });

    // Çekilişi sıfırlama
    socket.on('reset-raffle', () => {
        participants.clear();
        socket.emit('participant-count', 0);
        socket.emit('raffle-reset');
    });

    socket.on('disconnect', () => {
        if (tiktokConnection) {
            tiktokConnection.disconnect();
        }
    });
});

const PORT = process.env.PORT || 8091;
server.listen(PORT, () => {
    console.log(`Backend sunucusu çalışıyor: http://localhost:${PORT}`);
}); 