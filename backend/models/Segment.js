import { DataTypes } from 'sequelize';

const defineSegmentModel = (sequelize) => {
  const Segment = sequelize.define(
    'Segment',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true
      },
      videoId: {
        field: 'video_id',
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        references: {
          model: 'videos',
          key: 'id'
        }
      },
      segmentIndex: {
        field: 'segment_index',
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        validate: {
          min: 0
        }
      },
      startTime: {
        field: 'start_time',
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: {
          min: 0
        }
      },
      endTime: {
        field: 'end_time',
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: {
          min: 0,
          isGreaterThanStartTime(value) {
            if (value !== null && this.startTime !== null && Number(value) < Number(this.startTime)) {
              throw new Error('endTime must be greater than or equal to startTime.');
            }
          }
        }
      },
      filePath: {
        field: 'file_path',
        type: DataTypes.STRING(500),
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [1, 500]
        }
      },
      analysis: {
        type: DataTypes.JSON,
        allowNull: true
      }
    },
    {
      tableName: 'segments',
      indexes: [
        {
          name: 'segments_video_id_idx',
          fields: ['video_id']
        },
        {
          name: 'segments_video_id_segment_index_unique',
          unique: true,
          fields: ['video_id', 'segment_index']
        }
      ]
    }
  );

  Segment.associate = ({ Video, BackgroundAsset, GenerationTask, ShotGenerationTask }) => {
    if (Video) {
      Segment.belongsTo(Video, {
        foreignKey: 'videoId',
        as: 'video',
        onDelete: 'CASCADE'
      });
    }

    if (GenerationTask) {
      Segment.hasMany(GenerationTask, {
        foreignKey: 'segmentId',
        as: 'generationTasks',
        onDelete: 'CASCADE',
        hooks: true
      });
    }

    if (ShotGenerationTask) {
      Segment.hasMany(ShotGenerationTask, {
        foreignKey: 'segmentId',
        as: 'shotGenerationTasks',
        onDelete: 'CASCADE',
        hooks: true
      });
    }

    if (BackgroundAsset) {
      Segment.hasMany(BackgroundAsset, {
        foreignKey: 'sourceSegmentId',
        as: 'backgroundAssets',
        onDelete: 'SET NULL',
        hooks: true
      });
    }
  };

  return Segment;
};

export default defineSegmentModel;
