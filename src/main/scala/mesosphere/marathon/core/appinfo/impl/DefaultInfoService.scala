package mesosphere.marathon.core.appinfo.impl

import mesosphere.marathon.core.appinfo.AppInfo
import mesosphere.marathon.core.appinfo._
import mesosphere.marathon.state._
import org.slf4j.LoggerFactory

import scala.concurrent.Future
import scala.collection.immutable.Seq

private[appinfo] class DefaultInfoService(
    groupManager: GroupManager,
    appRepository: AppRepository,
    newBaseData: () => AppInfoBaseData) extends AppInfoService with GroupInfoService {
  import scala.concurrent.ExecutionContext.Implicits.global

  private[this] val log = LoggerFactory.getLogger(getClass)

  override def queryForAppId(id: PathId, embed: Set[AppInfo.Embed]): Future[Option[AppInfo]] = {
    log.debug(s"queryForAppId $id")
    appRepository.currentVersion(id).flatMap {
      case Some(app) => newBaseData().appInfoFuture(app, embed).map(Some(_))
      case None      => Future.successful(None)
    }
  }

  override def queryAll(selector: AppSelector, embed: Set[AppInfo.Embed]): Future[Seq[AppInfo]] = {
    log.debug(s"queryAll")
    groupManager.rootGroup()
      .map(_.transitiveApps.filter(selector.matches))
      .flatMap(resolveAppInfos(_, embed))
  }

  override def queryAllInGroup(groupId: PathId, embed: Set[AppInfo.Embed]): Future[Seq[AppInfo]] = {
    log.debug(s"queryAllInGroup $groupId")
    groupManager
      .group(groupId)
      .map(_.map(_.transitiveApps).getOrElse(Seq.empty))
      .flatMap(resolveAppInfos(_, embed))
  }

  override def queryForGroup(group: Group,
                             appEmbed: Set[AppInfo.Embed],
                             groupEmbed: Set[GroupInfo.Embed]): Future[GroupInfo] = {

    //fetch all transitive app infos with one request
    val appInfos = {
      if (groupEmbed(GroupInfo.Embed.Apps)) resolveAppInfos(group.transitiveApps, appEmbed)
      else Future.successful(Seq.empty)
    }

    appInfos.map { apps =>
      val infoById = apps.map(info => info.app.id -> info).toMap
      def queryGroup(ref: Group): GroupInfo = {
        val groups: Option[Seq[GroupInfo]] =
          if (groupEmbed(GroupInfo.Embed.Groups))
            Some(ref.groups.toIndexedSeq.map(queryGroup).sortBy(_.group.id))
          else
            None
        val apps: Option[Seq[AppInfo]] =
          if (groupEmbed(GroupInfo.Embed.Apps))
            Some(ref.apps.toIndexedSeq.flatMap(a => infoById.get(a.id)).sortBy(_.app.id))
          else
            None
        GroupInfo(ref, apps, groups)
      }
      queryGroup(group)
    }
  }

  private[this] def resolveAppInfos(apps: Iterable[AppDefinition], embed: Set[AppInfo.Embed]): Future[Seq[AppInfo]] = {
    val baseData = newBaseData()

    apps
      .foldLeft(Future.successful(Seq.newBuilder[AppInfo])) {
        case (builderFuture, app) =>
          builderFuture.flatMap { builder =>
            baseData.appInfoFuture(app, embed).map { appInfo =>
              builder += appInfo
              builder
            }
          }
      }.map(_.result())
  }
}
