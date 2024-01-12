const express = require('express');
const PORT = 3000;
const { MongoClient, ObjectId} = require("mongodb");
const MONGO_CONFIG_FILE = `./config/mongo.json`;
const { createHandler } = require('graphql-http/lib/use/express')
const expressPlayground = require('graphql-playground-middleware-express').default;
const { makeExecutableSchema } = require("@graphql-tools/schema");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));


const handedURL2Data = {
    'left': 'L',
    'right': 'R',
    'ambi': 'A'
}

const handedData2URL = {
    'L': 'left',
    'R': 'right',
    'A': 'ambi'
}

class Validator {

    is_set(obj){
        return !(obj === undefined || obj === null);
    }

    vali_active_p(obj){
        if (obj === undefined || obj === "*") {
            return undefined
        }
        return ['true'].includes(obj.toLowerCase());
    }

    vali_active_m(obj){
        if (obj === undefined || ['true'].includes(obj.toLowerCase())) {
            return true
        } if (obj === "*") {
            return undefined;
        }
        return false;
    }

    vali_currency(obj){
        return (v.is_set(obj) && /^\d+$/.test(obj) && parseInt(obj)>0);
    }

    vali_handed(obj){
        return obj in handedURL2Data;
    }

    vali_name(obj){
        return /^[a-zA-Z]+$/.test(obj);
    }

    vali_lname(obj){
        return (obj === '') || /^[a-zA-Z]+$/.test(obj);
    }

    vali_point(obj){
        return (/^(?!0\d)([1-9]\d*)$/.test(obj) && parseInt(obj)>0)
    }
}
const v = new Validator();

class Error {
    error_post_player(fname, lname, handed, balance){
        let err = [];
        if (!v.is_set(fname) || !v.vali_name(fname)){
            err.push("fname");
        }
        if (v.is_set(lname) && !v.vali_lname(lname)){
            err.push("lname");
        }
        if (!v.is_set(handed) || !v.vali_handed(handed)){
            err.push("handed");
        }
        if (!v.is_set(balance) || !v.vali_currency(balance)){
            err.push("initial_balance_usd_cents");
        }
        return err;
    }

    async error_post_match(p1_id, p2_id, entry_fee_usd_cents, prize_usd_cents){
        for (let item in {p1_id, p2_id, entry_fee_usd_cents, prize_usd_cents}){
            if (!v.is_set(item)){
                return 400;
            }
        }
        if (!v.vali_currency(prize_usd_cents) || !v.vali_currency(entry_fee_usd_cents)){
            return 400;
        }
        const p1 = await db.getPlayer(p1_id);
        const p2 = await db.getPlayer(p2_id);
        // for (let p of {p1, p2}
        if (p1 === null || p2 === null){
            return 404;
        } if (p1.in_active_match || p2.in_active_match){
            return 409;
        } if (p1.balance_usd_cents < entry_fee_usd_cents || p2.balance_usd_cents < entry_fee_usd_cents){
            return 402;
        } return 0;
    }

    async error_dp(mid,pid){
        if (await db.getMatch(mid) == null || await db.getPlayer(pid) == null){
            return 404;
        } else {
            let match = await db.getMatch(mid);
            if (!match.is_active) {
                return 409
            } if (match.p1_id === pid || match.p2_id === pid) {
                return 0;
            }
            return 400;
        }
    }

    async error_award(mid, pid, point){
        const player = await db.getPlayer(pid);
        const match = await db.getMatch(mid);
        if (player === undefined || match === undefined){
            return 404;
        } if (!match.is_active) {
            return 409;
        } if (!v.vali_point(point) || ! [match.p1_id, match.p2_id].includes(pid)) {
            return 400
        }
        return 0;

    }

    async error_end_match(mid){
        const match = await db.getMatch(mid);
        if (match === undefined) {
            return 404;
        } if (!match.is_active || match.p1_points === match.p2_points) {
            return 409
        }
        return 0;
    }

    error_print(err){
        let res = "invalid_fields: ";
        res += err.join(", ");
        return res;
    }
}
const e = new Error();

class Decorator {

    deco_is_active(is_active){
        if (is_active === undefined || ['1', 'true', 't'].includes(is_active)){
            return true;
        }
        return false;
    }

    async deco_player(p){
        if (p.length === 0){
            return null
        }
        if (Array.isArray(p)){
            p = p[0];
        }
        const player_match_info = await this.deco_player_match(p._id);
        return {
            pid: p._id,
            fname: p.fname,
            lname: p.lname,
            name: `${p.fname}${(p.lname !== "") ? ' ' + p.lname : ''}`,
            handed: handedData2URL[p.handed],
            is_active: p.is_active,
            balance_usd_cents: parseInt(p.balance_usd_cents),
            num_dq: p.num_dq ?? 0,
            in_active_match: p.in_active_match ?? false,
            ...player_match_info
        }
    }

    async deco_player_match(pid){
        const info = await db.getPlayerMatchInfo(pid);
        return {
            num_join: info.num_join,
            num_won: info.num_won,
            total_points: info.total_points,
            total_prize_usd_cents: info.total_prize_usd_cents,
            efficiency: info.num_join ? info.num_won / info.num_join : 0
        }
    }

    async deco_players(players, is_active){
        is_active = v.vali_active_p(is_active);
        let sorted = [];
        for (let player of players){
            player = await d.deco_player(player);
            if (is_active === undefined || player.is_active === is_active){
                sorted.push(player);
            }
        }
        sorted.sort((a, b) => {
            if (a.name<b.name) {return -1}
            else if (a.name>b.name) {return 1}
            else {return 0}
        })
        return sorted;
    }

    deco_currency(currency){
        return JSON.stringify({
            old_balance_usd_cents: currency.old,
            new_balance_usd_cents: currency.new
        })
    }

    async deco_match(m) {
        const timestamp = new Date();
        if (m.length === 0){
            return null
        }
        if (Array.isArray(m)){
            m = m[0];
        }
        let p1 = await db.getPlayer(m.p1_id.toString());
        let p2 = await db.getPlayer(m.p2_id.toString());
        let age = m.ended_at ? (m.ended_at - m.created_at)/1000 : (timestamp - m.created_at)/1000;
        age = Math.round(age);
        return {
            mid: m._id.toString(),
            entry_fee_usd_cents: m.entry_fee_usd_cents,
            p1_id: m.p1_id.toString(),
            p1_name: p1.name,
            p1_points: m.p1_points ?? 0,
            p2_id: m.p2_id.toString(),
            p2_name: p2.name,
            p2_points: m.p2_points ?? 0,
            winner_pid: m.winner_pid ?? null,
            is_dq: m.is_dq ??false,
            is_active: !Boolean(m.ended_at),
            prize_usd_cents: m.prize_usd_cents,
            age: age,
            ended_at: m.ended_at ? m.ended_at.toISOString() : null
        }
    }

    async deco_matches(matches, is_active){
        is_active = v.vali_active_m(is_active);
        let sorted = [];
        for (let match of matches){
            match = await d.deco_match(match);
            if (is_active === undefined || (match.is_active === is_active)){
                sorted.push(match);
            }
        }
        sorted.sort((a, b) => {
            if (a.prize_usd_cents<b.prize_usd_cents) {return 1}
            else if (a.name>b.name) {return -1}
            else {return 0}
        })
        return sorted;
    }
}
const d = new Decorator();

class SourceMongo {
    constructor(FILEPATH){
        try{
            this.config = require(FILEPATH);
        }
        catch{
            this.config = {
                "host":"localhost",
                "port":"27017",
                "db":"ee547_hw",
                "opts":{
                    "useUnifiedTopology":true
                }
            }
        }
        const uri = `mongodb://${this.config.host}:${this.config.port}`;
        const client = new MongoClient(uri, this.config.opts);
        try {
            const database = client.db("ee547_hw");
            this._db = database;
            const player = database.collection("player");
            const match = database.collection("match");
        } catch (err) {
            process.exit(5);
        }
    };

    async getPlayers(is_active) {
        try{
            let players =  await this._db.collection("player").find().toArray();
            return await d.deco_players(players, is_active);
        } catch {
            process.exit(5)
        }
    }

    async getPlayer(pid) {
        try{
            let player = await this._db.collection("player").find({"_id":ObjectId(pid)}).toArray();
            return await d.deco_player(player);
        } catch {
            // process.exit(5)
        }
    }

    async createPlayer(fname, lname, handed, is_active, initial_balance_usd_cents) {
        let timestamp = new Date();
        const data = {
            fname:fname,
            lname:lname,
            handed:handed,
            is_active:true,
            balance_usd_cents:initial_balance_usd_cents,
            num_dq: 0,
            in_active_match: false,
            created_at: timestamp
        };
        try {
            const { insertedId: pid } = await this._db.collection("player").insertOne(data);
            return this.getPlayer(pid);
        } catch {
            process.exit(5)
        }
    }

    async updatePlayer(pid, lname, is_active, deposit) {
        let timestamp = new Date();
        let player = await this._db.collection("player").find({"_id":ObjectId(pid)}).toArray();
        if (player.length>0) {
            let deposited = false;
            let balance = 0;
            let updatePlayer = {$set: {}}
            if (lname != null) {
                updatePlayer.$set.lname = lname;
                updatePlayer.$set.updated_at = timestamp;
            }
            if (is_active != null) {
                updatePlayer.$set.is_active = is_active;
                updatePlayer.$set.updated_at = timestamp;
            }
            if (deposit != null) {
                balance = parseInt(player[0].balance_usd_cents) + parseInt(deposit);
                updatePlayer.$set.balance_usd_cents = parseInt(balance);
                updatePlayer.$set.updated_at = timestamp;
                deposited = true;
            }
            await this._db.collection("player").updateOne({_id: ObjectId(pid)}, updatePlayer);
            // if (deposited) {
            //     return {pid, old: parseInt(player[0].balance_usd_cents), new: balance}
            // } else {
                return this.getPlayer(pid);
            // }
        } else {
            return null;
        }
    }

    async deletePlayer(pid){
        let player = await this._db.collection("player").find({"_id":ObjectId(pid)}).toArray();
        if (player.length>0){
            await this._db.collection("player").deleteOne({"_id":ObjectId(pid)});
            return true;
        }
        throw new Error();
    }

    async getPlayerMatchInfo(pid){
        const num_join = await this._db.collection("match").count({ $or: [{ 'p1_id': pid }, { 'p2_id': pid }] });
        const num_won = num_join ? await this._db.collection("match").count({'winner_pid': pid}) : 0;
        const total_points = num_won ? await this._db.collection("match").aggregate([
            {$match: {winner_pid: ObjectId(pid)}},
            {$group: {
                    _id: null,
                    totalPoints: { $sum: "$winner_point" }
                }}
        ]) : 0;
        const total_prize_usd_cents = num_won ? await this._db.collection("match").aggregate([
            {$match: {winner_pid: ObjectId(pid)}},
            {$group: {
                    _id: null,
                    totalPoints: { $sum: "$prize_usd_cents" }
                }}
        ]) : 0;
        return {
            num_join: num_join,
            num_won: num_won,
            total_points: total_points,
            total_prize_usd_cents: total_prize_usd_cents
        }
    }

    async getMatches(is_active){
        try{
            let matches =  await this._db.collection("match").find().toArray();
            return await d.deco_matches(matches, is_active);
        } catch(error) {
            process.exit(5)
        }
    }

    async getMatch(mid) {
        try{
            let match = await this._db.collection("match").find({"_id":ObjectId(mid)}).toArray();
            return d.deco_match(match);
        } catch {
            // process.exit(5)
        }
    }

    async createMatch(p1_id, p2_id, entry_fee_usd_cents, prize_usd_cents){
        let timestamp = new Date();
        const data = {
            ended_at: null,
            entry_fee_usd_cents: entry_fee_usd_cents,
            is_dq: false,
            p1_id: p1_id,
            p1_points: 0,
            p2_id: p2_id,
            p2_points: 0,
            prize_usd_cents: prize_usd_cents,
            winner_pid: null,
            winner_point: 0,
            created_at: timestamp
        }
        try {
            await this.updatePlayer(p1_id, null, null, -entry_fee_usd_cents);
            await this.updatePlayer(p2_id, null, null, -entry_fee_usd_cents);
            await this._db.collection("player").updateOne({_id: ObjectId(p1_id)}, {$set: {in_active_match: true}});
            await this._db.collection("player").updateOne({_id: ObjectId(p2_id)}, {$set: {in_active_match: true}});
            const { insertedId: mid } = await this._db.collection("match").insertOne(data);
            return this.getMatch(mid);
        } catch(err) {
            process.exit(5)
        }
    }

    async dqPlayer(mid, pid) {
        const match = await db.getMatch(mid);
        const player = await db.getPlayer(pid);
        await this._db.collection("player").updateOne({_id: ObjectId(pid)}, {$set: {num_dq: player.num_dq+1,}});
        await this._db.collection("match").updateOne({_id:ObjectId(mid)}, {$set: {is_dq: true,}});
        await this.endMatch(mid, (match.p1_id === pid) ?  match.p2_id :match.p1_id);
        return await db.getMatch(mid);
    }

    async endMatch(mid, winner_id) {
        const match = await db.getMatch(mid);
        await this.updatePlayer(winner_id, null, null, match.prize_usd_cents);
        await this._db.collection("player").updateOne({_id: ObjectId(match.p1_id)}, {$set: {in_active_match: false}});
        await this._db.collection("player").updateOne({_id: ObjectId(match.p2_id)}, {$set: {in_active_match: false}});
        await this._db.collection("match").updateOne({_id:ObjectId(mid)}, {$set: {
                ended_at: new Date(),
                winner_pid: (match.p1_id === winner_id) ? ObjectId(match.p1_id) : ObjectId(match.p2_id),
                winner_points: (match.p1_id === winner_id) ? match.p1_points : match.p2_points
            }});
        return this.getMatch(mid);
    }

    async awardPlayer(mid, pid, point) {
        const match = await db.getMatch(mid);
        const update_point = (match.p1_id === pid ? match.p1_points : match.p2_points) + parseInt(point);
        if (match.p1_id === pid) {
            await this._db.collection("match").updateOne({_id:ObjectId(mid)}, {$set: {p1_points: update_point}});
        } else {
            await this._db.collection("match").updateOne({_id:ObjectId(mid)}, {$set: {p2_points: update_point}});
        }
        return this.getMatch(mid);
    }

}

const db = new SourceMongo(MONGO_CONFIG_FILE);

const typeDefs = `
type Query {
    player(pid: ID!): Player
    
    players(
        limit: Int # you may skip this field
        offset: Int # you may skip this field
        sort: String # you may skip this field
        is_active: Boolean
        q: String
    ): [Player]!

    match(mid: ID!): Match
    matches(
        limit: Int # you may skip this field
        offset: Int # you may skip this field
        sort: String # you may skip this field
        is_active: Boolean
    ): [Match]!
    
    dashboard: Dashboard
}
type Mutation {

    matchAward(
        mid: ID!
        pid: ID!
        points: Int!
    ): Match
    
    matchCreate(
        pid1: ID!
        pid2: ID!
        entry_fee_usd_cents: Int!
        prize_usd_cents: Int!
    ): Match
    
    matchDisqualify(
        mid: ID!
        pid: ID!
    ): Match
    
    matchEnd(
        mid: ID!
    ): Match
    
    playerCreate(
        playerInput: PlayerCreateInput
    ): Player
    
    playerDelete(pid: ID!): Boolean
    
    playerDeposit(
        pid: ID!
        amount_usd_cents: Int!
    ): Player
    
    playerUpdate(
        pid: ID!
        playerInput: PlayerUpdateInput
    ): Player
    
}
enum HandedEnum {
    ambi
    left
    right
}
    
input PlayerCreateInput {
    fname: String!
    handed: HandedEnum
    initial_balance_usd_cents: Int!
    lname: String
}
    
input PlayerUpdateInput {
    is_active: Boolean
    lname: String
}
    
type Player {
    balance_usd_cents: Int
    efficiency: Float
    fname: String
    handed: HandedEnum
    in_active_match: Match
    is_active: Boolean
    lname: String
    name: String
    num_dq: Int
    num_join: Int
    num_won: Int
    pid: ID!
    total_points: Int
    total_prize_usd_cents: Int
}
    
type Match {
    age: Int
    ended_at: String
    entry_fee_usd_cents: Int
    is_active: Boolean
    is_dq: Boolean
    mid: ID!
    p1: Player!
    p1_points: Int
    p2: Player!
    p2_points: Int
    prize_usd_cents: Int
    winner: Player
}

type Dashboard {
    player: DashboardPlayer
}
    
type DashboardPlayer {
    avg_balance_usd_cents: Int
    num_active: Int
    num_inactive: Int
    num_total: Int
}
`;

const resolvers = {
    Mutation: {
        playerCreate: async (obj, { playerInput }, DB) => {
            const b = playerInput;
            let error = e.error_post_player(b.fname, b.lname, b.handed, b.initial_balance_usd_cents);
            if (error.length === 0) {
                const player =  await db.createPlayer(b.fname, b.lname, handedURL2Data[b.handed], true, b.initial_balance_usd_cents);
                return player;
            } else {
                e.error_print(error);
                throw new Error();
            }
        },
        playerUpdate: async (obj, { pid, playerInput }, DB) => {
            let is_active = d.deco_is_active(playerInput.is_active);
            let lname = playerInput.lname ?? null;
                return db.updatePlayer(pid, lname, is_active, null);
        },
        playerDelete: async (obj, { pid }, DB) => {
            const deleted = await db.deletePlayer(pid).catch((err) => {
                throw err;
            });
            if (deleted){
                return true;
            }
        },
        playerDeposit: async (obj, { pid, amount_usd_cents }, DB) => {
            let deposit = amount_usd_cents;
            if (!v.vali_currency(deposit)) {
                throw new Error();
            } else {
                let update = await db.updatePlayer(pid, null, null, deposit);
                if (update === null){
                    throw new Error();
                }
                    return update
            }
        },

        matchCreate: async (obj, { pid1, pid2, entry_fee_usd_cents, prize_usd_cents }, DB) => {
            const err_code = await e.error_post_match(pid1, pid2, entry_fee_usd_cents, prize_usd_cents);
            if (err_code){
                return new Error();
            } else {
                return db.createMatch(pid1, pid2, entry_fee_usd_cents, prize_usd_cents);
            }
        },
        matchAward: async (obj, { mid, pid, points }, DB) => {
            const err_code = await e.error_award(mid, pid, points);
            if (err_code !== 0){
                throw new Error();
            } else {
                return db.awardPlayer(mid, pid, points);
            }
        },
        matchDisqualify: async (obj, { mid, pid }, DB) => {
            const err_code = await e.error_dp(mid, pid);
            if (err_code){
                throw new Error();
            } else {
                return db.dqPlayer(mid, pid);
            }
        },

        matchEnd: async (obj, { mid }, DB) => {
            const err_code = await e.error_end_match(mid);
            if (err_code){
                throw new Error();
            } else {
                const match = await db.getMatch(mid);
                return (await db.endMatch(mid, (match.p1_points > match.p2_points) ? match.p1_id : match.p2_id));
            }
        },
    },

    Query: {
        player: async ({}, { pid }, DB) => {
            return await DB.getPlayer(pid);
        },

        players: async ({}, { is_active, q }, DB) => {
            if (q !== undefined) {
                let name = decodeURIComponent(q.split(";")[0]);
                var vars = q.split(";")[1] || "fname,lname";
                return await DB.getNamePlayers(name, vars);
            }
            if (is_active == undefined || is_active == "*") {
                return await DB.getPlayers();
            } else {
                return DB.getSomePlayers(is_active);
            }
        },

        match: async (obj, { mid }, DB) => {
            return await DB.getMatch(mid);
        },

        matches: async (obj, { is_active, q }, DB) => {
            let is_active_1 = is_active || "true";
            if (is_active_1 === "*") {
                return await DB.getMatches();
            } else {
                return await DB.getSomeMatches(is_active_1);
            }
        },

        dashboard: async (obj, {}, DB) => {
            try {
                return await DB.getDashboard();
            } catch (err) {
                throw err;
            }
        },
    },
};

const schema = makeExecutableSchema({
    resolvers,
    resolverValidationOptions: {
        requireResolversForAllFields: "warn",
        requireResolversToMatchSchema: "warn",
    },
    typeDefs,
});
app.all('/graphql', createHandler({ schema }));
app.get('/playground', expressPlayground({ endpoint: '/graphql' }));
app.get("/ping", (req, res) => {
    res.sendStatus(204);
});
app.listen(PORT);
console.log(`GraphQL API server running at http://localhost:${PORT}/graphql`);
