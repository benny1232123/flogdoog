/**
 * LP.Room — 虚拟房间 + Avatar + 宠物 + 互动
 * 数据存 localStorage（key: lp_room），支持 KV 云端同步。
 */
(function () {
    'use strict';

    const LS_KEY = 'lp_room';

    // 房间装饰选项
    const WALL_COLORS = [
        { id: 'warm', label: '暖阳', bg: 'linear-gradient(135deg,#FFF7F0,#FFE8D6)' },
        { id: 'ocean', label: '海蓝', bg: 'linear-gradient(135deg,#E8F4FD,#D6EAF5)' },
        { id: 'forest', label: '森林', bg: 'linear-gradient(135deg,#E8F5E9,#C8E6C9)' },
        { id: 'lavender', label: '薰衣草', bg: 'linear-gradient(135deg,#F3E5F5,#E1BEE7)' },
        { id: 'sunset', label: '日落', bg: 'linear-gradient(135deg,#FFF3E0,#FFCCBC)' },
        { id: 'night', label: '星空', bg: 'linear-gradient(180deg,#1a1a2e,#16213e)' }
    ];

    // 家具/摆设
    const FURNITURE = [
        { id: 'plant', label: '🌿 绿植', icon: '🌿' },
        { id: 'lamp', label: '💡 台灯', icon: '💡' },
        { id: 'bookshelf', label: '📚 书架', icon: '📚' },
        { id: 'cushion', label: '🛋️ 抱枕', icon: '🛋️' },
        { id: 'photo', label: '🖼️ 照片墙', icon: '🖼️' },
        { id: 'clock', label: '⏰ 挂钟', icon: '⏰' }
    ];

    // 宠物
    const PETS = [
        { id: 'cat1', label: '小橘猫', emoji: '🐱', color: '#FFB347' },
        { id: 'dog2', label: '柯基', emoji: '🐕', color: '#D2A679' },
        { id: 'rabbit', label: '垂耳兔', emoji: '🐰', color: '#E8D4B8' },
        { id: 'bird', label: '鹦鹉', emoji: '🦜', color: '#4CAF50' }
    ];

    function getDefaultData() {
        return {
            wallColor: 'warm',
            furniture: ['plant', 'lamp', 'cushion'], // 已摆放的家具
            pets: ['cat1', 'dog2'],               // 已有的宠物
            avatarA: { x: 25, y: 55, pose: 'idle', outfit: 'default' },  // 阿蛙位置(百分比)
            avatarB: { x: 65, y: 55, pose: 'idle', outfit: 'default' }   // 阿狗位置
        };
    }

    function load() {
        try {
            var raw = localStorage.getItem(LS_KEY);
            if (raw) { var d = JSON.parse(raw); if (d && typeof d === 'object') return d; }
        } catch (e) {}
        return getDefaultData();
    }

    function save(data) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) {}
        if (window.LP && LP.Sync && LP.Sync.schedulePushAll) LP.Sync.schedulePushAll();
    }

    /** 更新墙壁颜色 */
    function setWallColor(colorId) {
        var data = load();
        data.wallColor = colorId;
        save(data);
        return data;
    }

    /** 切换家具 */
    function toggleFurniture(furnId) {
        var data = load();
        var idx = data.furniture.indexOf(furnId);
        if (idx >= 0) data.furniture.splice(idx, 1);
        else data.furniture.push(furnId);
        save(data);
        return data;
    }

    /** 切换宠物 */
    function togglePet(petId) {
        var data = load();
        var idx = data.pets.indexOf(petId);
        if (idx >= 0) data.pets.splice(idx, 1);
        else if (data.pets.length < 4) data.pets.push(petId);
        save(data);
        return data;
    }

    /** 移动 Avatar */
    function moveAvatar(who, x, y) {
        var data = load();
        var key = who === 'a' ? 'avatarA' : 'avatarB';
        data[key].x = Math.max(5, Math.min(90, x));
        data[key].y = Math.max(30, Math.min(85, y));
        save(data);
        return data;
    }

    /** 设置 Avatar 姿态 */
    function setAvatarPose(who, pose) {
        var data = load();
        var key = who === 'a' ? 'avatarA' : 'avatarB';
        data[key].pose = pose;
        save(data);
        return data;
    }

    function exportData() { return load(); }
    function importData(d) {
        if (d && typeof d === 'object') { save(d); return true; }
        return false;
    }

    window.LP = window.LP || {};
    window.LP.Room = {
        WALL_COLORS: WALL_COLORS,
        FURNITURE: FURNITURE,
        PETS: PETS,
        load: load,
        save: save,
        setWallColor: setWallColor,
        toggleFurniture: toggleFurniture,
        togglePet: togglePet,
        moveAvatar: moveAvatar,
        setAvatarPose: setAvatarPose,
        exportData: exportData,
        importData: importData
    };
})();
