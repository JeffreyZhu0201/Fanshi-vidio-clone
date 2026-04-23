import { DataTypes } from 'sequelize';

const defineAnalysisModel = (sequelize) => {
  const Analysis = sequelize.define(
    'Analysis',
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
        unique: true,
        references: {
          model: 'videos',
          key: 'id'
        }
      },
      plot: {
        type: DataTypes.TEXT('long'),
        allowNull: true
      },
      characters: {
        type: DataTypes.JSON,
        allowNull: true
      },
      backgrounds: {
        type: DataTypes.JSON,
        allowNull: true
      },
      analysisOptions: {
        field: 'analysis_options',
        type: DataTypes.JSON,
        allowNull: true
      },
      timeAnchors: {
        field: 'time_anchors',
        type: DataTypes.JSON,
        allowNull: true
      },
      geminiResponse: {
        field: 'gemini_response',
        type: DataTypes.TEXT('long'),
        allowNull: true
      }
    },
    {
      tableName: 'analyses',
      indexes: [
        {
          name: 'analyses_video_id_unique',
          unique: true,
          fields: ['video_id']
        }
      ]
    }
  );

  Analysis.associate = ({ Video }) => {
    if (Video) {
      Analysis.belongsTo(Video, {
        foreignKey: 'videoId',
        as: 'video',
        onDelete: 'CASCADE'
      });
    }
  };

  return Analysis;
};

export default defineAnalysisModel;
