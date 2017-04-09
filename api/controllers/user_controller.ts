import { GET, POST, QueryParam, BodyParam, PathParam, BaseController } from 'webapi-router';
import { ResObject } from "../common/res_object";
import { UserService } from "../services/user_service";
import * as Koa from 'koa';
import { User } from "../models/user";
import { DtoUser } from "../interfaces/dto_user";
import { DtoTeamQuit } from "../interfaces/dto_team_quit";
import { UserTeamService } from "../services/user_team_service";
import { SessionService } from "../services/session_service";
import { Message } from "../common/message";
import { RegToken } from "../common/reg_token";
import { DateUtil } from "../utils/date_util";
import { Setting } from "../utils/setting";
import { StringUtil } from "../utils/string_util";
import { MailService } from "../services/mail_service";
import { TeamService } from "../services/team_service";
import { ValidateUtil } from "../utils/validate_util";
import * as _ from "lodash";

export default class UserController extends BaseController {

    @POST('/user')
    async register( @BodyParam body: DtoUser): Promise<ResObject> {
        return await UserService.createUser(body.name, body.email, body.password);
    }

    @POST()
    async login(ctx: Koa.Context, @BodyParam body: DtoUser): Promise<ResObject> {
        let checkLogin = await UserService.checkUser(body.email, body.password);
        if (!checkLogin.success) {
            return checkLogin;
        }

        SessionService.login(ctx, (<User>checkLogin.result).id);

        checkLogin.message = Message.userLoginSuccess;
        (<User>checkLogin.result).password = undefined;

        return checkLogin;
    }

    @GET()
    logout(ctx: Koa.Context): ResObject {
        SessionService.logout(ctx);
        return { success: true, message: Message.userLogout };
    }

    @POST('/user/quitteam')
    async quitTeam( @BodyParam info: DtoTeamQuit): Promise<ResObject> {
        return await UserTeamService.quitTeam(info);
    }

    @GET('/user/regconfirm')
    async regConfirm( @QueryParam('id') id: string, @QueryParam('token') token: string): Promise<ResObject> {
        const user = await UserService.getUserById(id);
        if (!user) {
            return { success: false, message: Message.regConfireFailed_userNotExist };
        }

        if (user.isActive) {
            return { success: false, message: Message.regConfireFailed_userConfirmed };
        }

        const json = StringUtil.decrypt(token);
        const info = <RegToken>JSON.parse(json);

        if (!info || info.host !== Setting.instance.app.host) {
            return { success: false, message: Message.regConfireFailed_invalid };
        }

        if (DateUtil.diff(new Date(info.date), new Date()) > 24) {
            return { success: false, message: Message.regConfireFailed_expired };
        }

        UserService.active(user.id);

        return { success: true, message: Message.regConfirmSuccess };
    }

    @GET('/user/invite/:emails')
    async invite(ctx: Koa.Context, @PathParam('emails') emails: string): Promise<ResObject> {
        const checkEmailsRst = ValidateUtil.checkEmails(emails);
        if (!checkEmailsRst.success) {
            return checkEmailsRst;
        }
        let emailArr = <Array<string>>checkEmailsRst.result;

        const userId = SessionService.getUserId(ctx);
        const user = await UserService.getUserById(userId);

        if (!user) {
            return { success: false, message: Message.invite_InviterNotExist };
        }

        const rsts = await Promise.all(emailArr.map(email => MailService.inviterMail(email, user)));
        return { success: rsts.every(rst => !rst.err), message: rsts.map(rst => rst.err).join(';') };
    }

    @GET('/user/invitetoteam')
    async inviteToTeam(ctx: Koa.Context, @QueryParam('teamid') teamId: string, @QueryParam('emails') emails: string): Promise<ResObject> {
        const checkEmailsRst = ValidateUtil.checkEmails(emails);
        if (!checkEmailsRst.success) {
            return checkEmailsRst;
        }
        let emailArr = <Array<string>>checkEmailsRst.result;

        const team = await TeamService.getTeam(teamId, false, true);

        if (!team) {
            return { success: false, message: Message.teamNotExist };
        }

        emailArr = _.difference(emailArr, team.members.map(t => t.email));
        if (emailArr.length === 0) {
            return { success: false, message: Message.emailsAllInTeam };
        }

        const userId = SessionService.getUserId(ctx);
        const user = await UserService.getUserById(userId);

        if (!user) {
            return { success: false, message: Message.invite_InviterNotExist };
        }

        const rsts = await Promise.all(emailArr.map(email => MailService.teamInviterMail(email, user, team)));

        const success = rsts.every(rst => !rst.err);
        if (success) { //TODO: add in trancation is the better way
            await Promise.all(emailArr.map(email => UserService.createUserByEmail(email)));
        }

        return { success: success, message: rsts.map(rst => rst.err).join(';') };
    }
}