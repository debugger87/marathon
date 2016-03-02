package mesosphere.marathon.core.appinfo.impl

import mesosphere.marathon.core.appinfo._
import mesosphere.marathon.core.appinfo.AppInfo.Embed
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

  override def selectApp(id: PathId, selector: AppSelector, embed: Set[AppInfo.Embed]): Future[Option[AppInfo]] = {
    log.debug(s"queryForAppId $id")
    appRepository.currentVersion(id).flatMap {
      case Some(app) if selector.matches(app) => newBaseData().appInfoFuture(app, embed).map(Some(_))
      case None                               => Future.successful(None)
    }
  }

  override def selectBy(selector: AppSelector, embed: Set[AppInfo.Embed]): Future[Seq[AppInfo]] = {
    log.debug(s"queryAll")
    groupManager.rootGroup()
      .map(_.transitiveApps.filter(selector.matches))
      .flatMap(resolveAppInfos(_, embed))
  }

  override def selectAppsInGroup(groupId: PathId, selector: AppSelector,
                                 embed: Set[AppInfo.Embed]): Future[Seq[AppInfo]] = {
    log.debug(s"queryAllInGroup $groupId")
    groupManager
      .group(groupId)
      .map(_.map(_.transitiveApps.filter(selector.matches)).getOrElse(Seq.empty))
      .flatMap(resolveAppInfos(_, embed))
  }

  override def selectGroup(groupId: PathId, groupSelector: GroupSelector,
                           appEmbed: Set[Embed], groupEmbed: Set[GroupInfo.Embed]): Future[Option[GroupInfo]] = {
    groupManager.group(groupId).flatMap {
      case Some(group) => queryForGroup(group, groupSelector, appEmbed, groupEmbed).map(Some(_))
      case None        => Future.successful(None)
    }
  }

  override def selectGroupVersion(groupId: PathId, version: Timestamp, groupSelector: GroupSelector,
                                  groupEmbed: Set[GroupInfo.Embed]): Future[Option[GroupInfo]] = {
    groupManager.group(groupId, version).flatMap {
      case Some(group) => queryForGroup(group, groupSelector, Set.empty, groupEmbed).map(Some(_))
      case None        => Future.successful(None)
    }
  }

  private[this] def queryForGroup(group: Group,
                                  groupSelector: GroupSelector,
                                  appEmbed: Set[AppInfo.Embed],
                                  groupEmbed: Set[GroupInfo.Embed]): Future[GroupInfo] = {

    //fetch all transitive app infos with one request
    val appInfos = {
      if (groupEmbed(GroupInfo.Embed.Apps))
        resolveAppInfos(group.transitiveApps.filter(groupSelector.matches), appEmbed)
      else
        Future.successful(Seq.empty)
    }

    appInfos.map { apps =>
      val infoById = apps.map(info => info.app.id -> info).toMap
      def queryGroup(ref: Group): GroupInfo = {
        val groups: Option[Seq[GroupInfo]] =
          if (groupEmbed(GroupInfo.Embed.Groups))
            Some(ref.groups.toIndexedSeq.filter(groupSelector.matches).map(queryGroup).sortBy(_.group.id))
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
