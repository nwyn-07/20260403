var express = require("express");
var router = express.Router();
let messageModel = require('../schemas/messages');
let { checkLogin } = require('../utils/authHandler');

let { uploadImage } = require('../utils/upload');

// GET /:userID - Lấy toàn bộ đoạn chat giữa user hiện tại và userID
router.get('/:userID', checkLogin, async function (req, res, next) {
    try {
        let currentUserId = req.user._id;
        let otherUserId = req.params.userID;

        let messages = await messageModel.find({
            $or: [
                { from: currentUserId, to: otherUserId },
                { from: otherUserId, to: currentUserId }
            ]
        }).sort({ createdAt: 1 }); // Sắp xếp tăng dần theo thời gian (cũ -> mới)

        res.status(200).send(messages);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// POST / - Gửi tin nhắn
router.post('/', checkLogin, uploadImage.single('file'), async function (req, res, next) {
    try {
        let currentUserId = req.user._id;
        let toUserId = req.body.to;
        
        if (!toUserId) {
            return res.status(400).send({ message: "Thiếu thông tin người nhận (to)" });
        }

        let messageType = "text";
        let messageTextContent = req.body.text;

        // Nếu người dùng gửi file hình ảnh lên
        if (req.file) {
            messageType = "file";
            messageTextContent = req.file.path; // Lưu đường dẫn file
        } else if (!messageTextContent) {
            return res.status(400).send({ message: "Vui lòng nhập nội dung (text) hoặc đính kèm file" });
        }

        let newMessage = new messageModel({
            from: currentUserId,
            to: toUserId,
            messageContent: {
                type: messageType,
                text: messageTextContent
            }
        });

        await newMessage.save();
        res.status(201).send(newMessage);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// GET / - Lấy tin nhắn cuối cùng của mỗi đoạn chat (danh sách inbox)
router.get('/', checkLogin, async function (req, res, next) {
    try {
        let currentUserId = req.user._id;

        let latestMessages = await messageModel.aggregate([
            // 1. Chỉ lấy những tin nhắn mà user hiện tại có tham gia (gửi hoặc nhận)
            {
                $match: {
                    $or: [
                        { from: currentUserId },
                        { to: currentUserId }
                    ]
                }
            },
            // 2. Tạo field partner (người đang trò chuyện với mình) để dễ nhóm
            // Nếu from === currentUserId thì partner là to, ngược lại partner là from
            {
                $addFields: {
                    partner: {
                        $cond: {
                            if: { $eq: ["$from", currentUserId] },
                            then: "$to",
                            else: "$from"
                        }
                    }
                }
            },
            // 3. Sắp xếp tin nhắn từ mới nhất đến cũ nhất
            {
                $sort: { createdAt: -1 }
            },
            // 4. Nhóm theo từng partner. Lấy ra chi tiết tin nhắn đầu tiên ($first - tức là mới nhất do đã sort)
            {
                $group: {
                    _id: "$partner",
                    latestMessage: { $first: "$$ROOT" }
                }
            },
            // 5. Tạo cấu trúc trả về sạch gọn hơn (tuỳ chọn)
            {
                $replaceRoot: { newRoot: "$latestMessage" }
            },
            // 6. Sort lại danh sách inbox ngoài cùng để người nhắn gần nhất xếp lên trên
            {
                $sort: { createdAt: -1 }
            }
        ]);

        // Trả về kèm theo populate partner nếu cần thiết (Optional: dùng .populate nếu có Model)
        let result = await messageModel.populate(latestMessages, { path: "from to", select: "username email" });

        res.status(200).send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

module.exports = router;
