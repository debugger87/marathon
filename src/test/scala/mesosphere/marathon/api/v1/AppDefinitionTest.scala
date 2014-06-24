package mesosphere.marathon.api.v1

import com.google.common.collect.Lists
import scala.collection.JavaConverters._
import mesosphere.marathon.Protos.ServiceDefinition
import mesosphere.marathon.state.{ Migration, StorageVersions, Timestamp }
import org.apache.mesos.Protos.CommandInfo
import javax.validation.Validation
import mesosphere.marathon.MarathonSpec
import org.scalatest.Matchers
import mesosphere.marathon.state.PathId._

/**
  * @author Tobi Knaup
  */
class AppDefinitionTest extends MarathonSpec with Matchers {

  test("ToProto") {
    val app = AppDefinition(
      id = "play".toPath,
      cmd = "bash foo-*/start -Dhttp.port=$PORT",
      cpus = 4,
      mem = 256,
      instances = 5,
      ports = Seq(8080, 8081),
      executor = "//cmd"
    )

    val proto = app.toProto
    assert("play" == proto.getId)
    assert("bash foo-*/start -Dhttp.port=$PORT" == proto.getCmd.getValue)
    assert(5 == proto.getInstances)
    assert(Lists.newArrayList(8080, 8081) == proto.getPortsList)
    assert("//cmd" == proto.getExecutor)
    assert(4 == getScalarResourceValue(proto, "cpus"), 1e-6)
    assert(256 == getScalarResourceValue(proto, "mem"), 1e-6)
    // TODO test CommandInfo
  }

  test("MergeFromProto") {
    val cmd = CommandInfo.newBuilder
      .setValue("bash foo-*/start -Dhttp.port=$PORT")

    val proto = ServiceDefinition.newBuilder
      .setId("play")
      .setCmd(cmd)
      .setInstances(3)
      .setExecutor("//cmd")
      .setVersion(Timestamp.now.toString)
      .build

    val mergeResult = AppDefinition().mergeFromProto(proto)

    assert("play" == mergeResult.id.toString)
    assert(3 == mergeResult.instances)
    assert("//cmd" == mergeResult.executor)
    assert("bash foo-*/start -Dhttp.port=$PORT" == mergeResult.cmd)
  }

  test("Validation") {
    val validator = Validation.buildDefaultValidatorFactory().getValidator

    def shouldViolate(app: AppDefinition, path: String, template: String) = {
      val violations = validator.validate(app).asScala
      assert(violations.exists(v =>
        v.getPropertyPath.toString == path && v.getMessageTemplate == template))
    }

    def shouldNotViolate(app: AppDefinition, path: String, template: String) = {
      val violations = validator.validate(app).asScala
      assert(!violations.exists(v =>
        v.getPropertyPath.toString == path && v.getMessageTemplate == template))
    }

    /* TODO(MV): validate path id
    val app = AppDefinition(id = "a b")
    shouldViolate(app, "id", "{javax.validation.constraints.Pattern.message}")

    shouldViolate(
      app.copy(id = "a#$%^&*b"),
      "id",
      "{javax.validation.constraints.Pattern.message}"
    )

    shouldViolate(
      app.copy(id = "-dash-disallowed-at-start"),
      "id",
      "{javax.validation.constraints.Pattern.message}"
    )

    shouldViolate(
      app.copy(id = "dash-disallowed-at-end-"),
      "id",
      "{javax.validation.constraints.Pattern.message}"
    )

    shouldViolate(
      app.copy(id = "uppercaseLettersNoGood"),
      "id",
      "{javax.validation.constraints.Pattern.message}"
    )

    shouldNotViolate(
      app.copy(id = "ab"),
      "id",
      "{javax.validation.constraints.Pattern.message}"
    )
    */

    shouldViolate(
      AppDefinition(id = "test".toPath, instances = -3),
      "instances",
      "{javax.validation.constraints.Min.message}"
    )

    shouldViolate(
      AppDefinition(id = "test".toPath, instances = -3, ports = Seq(9000, 8080, 9000)),
      "ports",
      "Elements must be unique"
    )

    shouldNotViolate(
      AppDefinition(id = "test".toPath, ports = Seq(0, 0, 8080)),
      "ports",
      "Elements must be unique"
    )

    val correct = AppDefinition(id = "test".toPath)

    shouldNotViolate(
      correct.copy(executor = "//cmd"),
      "executor",
      "{javax.validation.constraints.Pattern.message}"
    )

    shouldNotViolate(
      correct.copy(executor = "some/relative/path.mte"),
      "executor",
      "{javax.validation.constraints.Pattern.message}"
    )

    shouldNotViolate(
      correct.copy(executor = "/some/absolute/path"),
      "executor",
      "{javax.validation.constraints.Pattern.message}"
    )

    shouldNotViolate(
      correct.copy(executor = ""),
      "executor",
      "{javax.validation.constraints.Pattern.message}"
    )

    shouldViolate(
      correct.copy(executor = "/test/"),
      "executor",
      "{javax.validation.constraints.Pattern.message}"
    )

    shouldViolate(
      correct.copy(executor = "/test//path"),
      "executor",
      "{javax.validation.constraints.Pattern.message}"
    )
  }

  test("SerializationRoundtrip") {
    import com.fasterxml.jackson.databind.ObjectMapper
    import com.fasterxml.jackson.module.scala.DefaultScalaModule
    import mesosphere.marathon.api.v2.json.MarathonModule
    import mesosphere.jackson.CaseClassModule

    val mapper = new ObjectMapper
    mapper.registerModule(DefaultScalaModule)
    mapper.registerModule(new MarathonModule)
    mapper.registerModule(CaseClassModule)

    val original = AppDefinition()
    val json = mapper.writeValueAsString(original)
    val readResult = mapper.readValue(json, classOf[AppDefinition])

    assert(readResult == original)
  }

  test("Migration") {
    val oldVersion = StorageVersions(0, 0, 0)

    val migration = implicitly[Migration[AppDefinition]]

    migration.needsMigration(oldVersion) should be(true)

    val migratedApp = migration.migrate(oldVersion, AppDefinition("My.super_Cool-app".toPath))

    migratedApp.id.toString should be("my.super-cool-app")
  }

  def getScalarResourceValue(proto: ServiceDefinition, name: String) = {
    proto.getResourcesList.asScala
      .find(_.getName == name)
      .get.getScalar.getValue
  }
}
